using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using AssettoServer.Network.ClientMessages;
using AssettoServer.Network.Tcp;
using AssettoServer.Server;
using AssettoServer.Server.Configuration;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace HowlerPlugin;

/// <summary>
/// Evento que manda el script de cliente (lua/howler_telemetry.lua) unas 5 veces por segundo: lo que el servidor no recibe
/// por sí solo (pedal de freno real, aceleración, datos de las ruedas). Los nombres deben coincidir con los del script.
/// </summary>
[OnlineEvent(Key = "howlerTel")]
public class HowlerTelPacket : OnlineEvent<HowlerTelPacket>
{
    [OnlineEventField(Name = "brake")] public float Brake;
    [OnlineEventField(Name = "gas")] public float Gas;
    [OnlineEventField(Name = "clutch")] public float Clutch;
    [OnlineEventField(Name = "steer")] public float Steer;
    [OnlineEventField(Name = "speed")] public float Speed;
    [OnlineEventField(Name = "ax")] public float Ax;
    [OnlineEventField(Name = "ay")] public float Ay;
    [OnlineEventField(Name = "az")] public float Az;
    [OnlineEventField(Name = "slip0")] public float Slip0;
    [OnlineEventField(Name = "slip1")] public float Slip1;
    [OnlineEventField(Name = "slip2")] public float Slip2;
    [OnlineEventField(Name = "slip3")] public float Slip3;
    [OnlineEventField(Name = "load0")] public float Load0;
    [OnlineEventField(Name = "load1")] public float Load1;
    [OnlineEventField(Name = "load2")] public float Load2;
    [OnlineEventField(Name = "load3")] public float Load3;
    [OnlineEventField(Name = "pres0")] public float Pres0;
    [OnlineEventField(Name = "pres1")] public float Pres1;
    [OnlineEventField(Name = "pres2")] public float Pres2;
    [OnlineEventField(Name = "pres3")] public float Pres3;
    [OnlineEventField(Name = "temp0")] public float Temp0;
    [OnlineEventField(Name = "temp1")] public float Temp1;
    [OnlineEventField(Name = "temp2")] public float Temp2;
    [OnlineEventField(Name = "temp3")] public float Temp3;
    [OnlineEventField(Name = "flags")] public int Flags;
}

/// <summary>
/// Activo por defecto (ClientTelemetry: false en plugin_howler_cfg.yml lo apaga). Reparte a los clientes con CSP el
/// script lua/howler_telemetry.lua (se descarga solo al conectarse: nadie instala nada), recibe sus mensajes, los apunta en
/// howler-client-telemetry.csv (junto al plugin) y los reenvía a Howler como {"t":"ctel"}. Los datos vienen del PC de cada
/// jugador: valen para estadísticas, no para sancionar.
/// </summary>
public class HowlerClientTelemetry : IHostedService, IDisposable
{
    private readonly HowlerConfiguration _config;
    private readonly bool _enabled;
    private UdpClient? _udp;
    private IPEndPoint? _target;
    private StreamWriter? _csv;
    private readonly object _csvLock = new();

    public HowlerClientTelemetry(HowlerConfiguration config, ACServerConfiguration serverConfiguration,
        CSPServerScriptProvider scriptProvider, CSPClientMessageTypeManager messageTypes)
    {
        _config = config;
        if (!config.ClientTelemetry) return;
        if (!serverConfiguration.Extra.EnableClientMessages)
        {
            Log.Warning("[Howler] ClientTelemetry necesita EnableClientMessages: true en extra_cfg.yml; se desactiva");
            return;
        }
        try
        {
            var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;
            scriptProvider.AddScript(File.ReadAllText(Path.Join(dir, "lua", "howler_telemetry.lua")), "howler_telemetry.lua");
            messageTypes.RegisterOnlineEvent<HowlerTelPacket>(OnPacket);
            var address = IPAddress.TryParse(config.Host, out var ip) ? ip : Dns.GetHostAddresses(config.Host).First(a => a.AddressFamily == AddressFamily.InterNetwork);
            _target = new IPEndPoint(address, config.Port);
            _udp = new UdpClient();
            var csvPath = Path.Join(dir, "howler-client-telemetry.csv");
            _csv = new StreamWriter(new FileStream(csvPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
            if (new FileInfo(csvPath).Length == 0) _csv.WriteLine("unix_ms,car,brake,gas,clutch,steer,speed,ax,ay,az,slip0,slip1,slip2,slip3,load0,load1,load2,load3,pres0,pres1,pres2,pres3,temp0,temp1,temp2,temp3,flags");
            _enabled = true;
            Log.Information("[Howler] telemetría de cliente activada (script howler_telemetry.lua; datos en {Csv})", csvPath);
        }
        catch (Exception e)
        {
            // Un fallo aquí nunca debe tumbar el servidor.
            Log.Error(e, "[Howler] no se pudo activar la telemetría de cliente");
        }
    }

    private void OnPacket(ACTcpClient client, HowlerTelPacket p)
    {
        if (!_enabled) return;
        try
        {
            var f = CultureInfo.InvariantCulture;
            var values = new[] { p.Brake, p.Gas, p.Clutch, p.Steer, p.Speed, p.Ax, p.Ay, p.Az, p.Slip0, p.Slip1, p.Slip2, p.Slip3, p.Load0, p.Load1, p.Load2, p.Load3, p.Pres0, p.Pres1, p.Pres2, p.Pres3, p.Temp0, p.Temp1, p.Temp2, p.Temp3 };
            lock (_csvLock)
                _csv?.WriteLine($"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()},{client.SessionId},{string.Join(",", values.Select(v => v.ToString("0.####", f)))},{p.Flags}");
            if (_udp == null || _target == null) return;
            var data = JsonSerializer.SerializeToUtf8Bytes(new
            {
                v = 1, t = "ctel", car = (int)client.SessionId, guid = client.Guid.ToString(),
                brake = p.Brake, gas = p.Gas, ax = p.Ax, ay = p.Ay, az = p.Az, flags = p.Flags,
                slip = new[] { p.Slip0, p.Slip1, p.Slip2, p.Slip3 }, load = new[] { p.Load0, p.Load1, p.Load2, p.Load3 },
                pres = new[] { p.Pres0, p.Pres1, p.Pres2, p.Pres3 }, temp = new[] { p.Temp0, p.Temp1, p.Temp2, p.Temp3 },
            });
            _udp.Send(data, data.Length, _target);
        }
        catch (Exception e)
        {
            Log.Debug(e, "[Howler] no se pudo procesar un mensaje de telemetría de cliente");
        }
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public void Dispose()
    {
        _udp?.Dispose();
        lock (_csvLock) _csv?.Dispose();
    }
}
