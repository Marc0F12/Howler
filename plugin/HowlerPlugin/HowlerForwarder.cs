using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using AssettoServer.Network.Tcp;
using AssettoServer.Server;
using AssettoServer.Shared.Network.Packets.Incoming;
using AssettoServer.Shared.Network.Packets.Outgoing;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace HowlerPlugin;

/// <summary>
/// Reenvía a Howler, por UDP local, los sectores y vueltas que el juego de cada piloto manda al servidor.
/// El protocolo UDP de plugins de AC no lleva sectores; este plugin los saca del propio servidor, al milisegundo.
///
/// Mensajes (una línea JSON por datagrama, versión 1):
///   {"v":1,"t":"split","car":0,"guid":"7656...","i":2,"ms":25380,"cuts":0}
///   {"v":1,"t":"lap","car":0,"guid":"7656...","ms":99541,"cuts":0}
///   {"v":1,"t":"tel","car":0,"guid":"7656...","gas":212,"steer":131,"brk":0,"yaw":1.5708}   (TelemetryHz veces por segundo y coche)
///     gas: 0..255 (acelerador) · steer: 0..254, 127 = recto · brk: 1 si las luces de freno están encendidas (no es analógico)
///     yaw: giro del coche en radianes (hacia dónde apunta el morro; Howler calibra su convención con la dirección de la velocidad)
///     tyre: velocidad angular de las 4 ruedas (FL, FR, RL, RR), tal como la manda el juego: un byte por rueda en escala
///           logarítmica (w = 10^((b-100)/20) - 1 rad/s, si b >= 100). Howler la usa para detectar patinazo y bloqueo.
/// </summary>
public class HowlerForwarder : BackgroundService
{
    private const int ProtocolVersion = 1;

    private readonly EntryCarManager _entryCars;
    private readonly HowlerConfiguration _config;
    private UdpClient? _udp;
    private IPEndPoint? _target;
    private readonly HashSet<EntryCar> _subscribed = new();
    private readonly long[] _lastTelemetry = new long[256];

    public HowlerForwarder(EntryCarManager entryCars, HowlerConfiguration config)
    {
        _entryCars = entryCars;
        _config = config;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var address = IPAddress.TryParse(_config.Host, out var ip) ? ip : Dns.GetHostAddresses(_config.Host).First(a => a.AddressFamily == AddressFamily.InterNetwork);
            _target = new IPEndPoint(address, _config.Port);
            _udp = new UdpClient();
            _entryCars.ClientConnected += OnClientConnected;
            Log.Information("[Howler] enviando sectores y vueltas a {Target}", _target);
            _ = HeartbeatAsync(stoppingToken);
        }
        catch (Exception e)
        {
            // Un fallo de Howler nunca debe tumbar el servidor.
            Log.Error(e, "[Howler] no se pudo iniciar el plugin");
        }

        return Task.CompletedTask;
    }

    /// <summary>Latido: así Howler sabe que el plugin está activo aunque nadie esté conduciendo.</summary>
    private async Task HeartbeatAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            Send(new { v = ProtocolVersion, t = "hello" });
            try { await Task.Delay(TimeSpan.FromSeconds(5), token); }
            catch (OperationCanceledException) { return; }
        }
    }

    private void OnClientConnected(ACTcpClient client, EventArgs args)
    {
        client.SectorSplit += OnSectorSplit;
        client.LapCompleted += OnLapCompleted;
        // El EntryCar es el mismo para todos los pilotos que pasen por ese hueco: se engancha una sola vez.
        if (_config.TelemetryHz > 0)
        {
            lock (_subscribed)
            {
                if (_subscribed.Add(client.EntryCar)) client.EntryCar.PositionUpdateReceived += OnPositionUpdate;
            }
        }
    }

    /// <summary>Acelerador, freno, volante y orientación del coche, a lo sumo TelemetryHz veces por segundo.</summary>
    private void OnPositionUpdate(EntryCar car, in PositionUpdateIn p)
    {
        var client = car.Client;
        if (client == null) return;
        var now = Environment.TickCount64;
        // Los paquetes de posición no llegan con una cadencia exacta: con un umbral estricto una muestra que llega un
        // poco pronto se descarta y se pierde el hueco entero. Se deja un 20 % de margen.
        if (now - _lastTelemetry[car.SessionId] < 800 / _config.TelemetryHz) return;
        _lastTelemetry[car.SessionId] = now;
        Send(new
        {
            v = ProtocolVersion, t = "tel", car = (int)car.SessionId, guid = client.Guid.ToString(),
            gas = (int)p.Gas, steer = (int)p.SteerAngle, brk = (p.StatusFlag & CarStatusFlags.BrakeLightsOn) != 0 ? 1 : 0,
            yaw = MathF.Round(p.Rotation.X, 4),
            tyre = new[] { (int)p.TyreAngularSpeedFL, (int)p.TyreAngularSpeedFR, (int)p.TyreAngularSpeedRL, (int)p.TyreAngularSpeedRR },
        });
    }

    private void OnSectorSplit(ACTcpClient client, SectorSplitEventArgs args)
    {
        Send(new
        {
            v = ProtocolVersion, t = "split", car = client.SessionId, guid = client.Guid.ToString(),
            i = args.Packet.SplitIndex, ms = args.Packet.SplitTime, cuts = args.Packet.Cuts,
        });
    }

    private void OnLapCompleted(ACTcpClient client, LapCompletedEventArgs args)
    {
        Send(new
        {
            v = ProtocolVersion, t = "lap", car = client.SessionId, guid = client.Guid.ToString(),
            ms = args.Packet.LapTime, cuts = args.Packet.Cuts,
        });
    }

    private void Send(object message)
    {
        try
        {
            if (_udp == null || _target == null) return;
            var data = JsonSerializer.SerializeToUtf8Bytes(message);
            _udp.Send(data, data.Length, _target);
        }
        catch (Exception e)
        {
            Log.Debug(e, "[Howler] no se pudo enviar un mensaje");
        }
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        _udp?.Dispose();
        return base.StopAsync(cancellationToken);
    }
}
