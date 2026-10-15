using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using AssettoServer.Commands;
using AssettoServer.Commands.Contexts;
using AssettoServer.Server;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace HowlerPlugin;

/// <summary>
/// Canal de órdenes del panel de Howler. Escucha en UDP SOLO en 127.0.0.1 y ejecuta comandos de administrador
/// del servidor (/settime, /setcspweather, /ballast...) desde dentro, como si los escribiera un admin en el chat.
///
/// Petición:   {"v":1,"id":"abc","cmd":"/settime 15:30"}
/// Respuesta:  {"v":1,"t":"result","id":"abc","ok":true,"reply":"texto del servidor"}
///
/// Solo se admiten los comandos de <see cref="Allowed"/>: el panel no necesita nada más y así un proceso local
/// no puede, por ejemplo, ejecutar comandos de depuración del servidor.
/// </summary>
public class HowlerCommands : BackgroundService
{
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        "settime", "time", "setweather", "setcspweather", "cspweather", "setrain", "setgrip",
        "ballast", "restrict", "restrictor", "kick", "kick_id", "ban", "ban_id", "say",
        "next_session", "restart_session", "ksns", "ksrs", "pit", "forcelights", "whois",
    };

    private const int MaxCommandLength = 300;

    private readonly EntryCarManager _entryCars;
    private readonly ChatService _chat;
    private readonly IServiceProvider _services;
    private readonly HowlerConfiguration _config;

    private readonly IHostApplicationLifetime _lifetime;

    public HowlerCommands(EntryCarManager entryCars, ChatService chat, IServiceProvider services, HowlerConfiguration config, IHostApplicationLifetime lifetime)
    {
        _entryCars = entryCars;
        _chat = chat;
        _services = services;
        _config = config;
        _lifetime = lifetime;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_config.CommandPort <= 0) return; // desactivado
        UdpClient udp;
        try
        {
            udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, _config.CommandPort));
        }
        catch (Exception e)
        {
            Log.Error(e, "[Howler] no se pudo abrir el canal de ordenes en 127.0.0.1:{Port}", _config.CommandPort);
            return;
        }

        Log.Information("[Howler] canal de ordenes del panel en 127.0.0.1:{Port}", _config.CommandPort);
        using (udp)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var received = await udp.ReceiveAsync(stoppingToken);
                    _ = HandleAsync(udp, received, stoppingToken);
                }
                catch (OperationCanceledException) { }
                catch (Exception e) { Log.Debug(e, "[Howler] error en el canal de ordenes"); }
            }
        }
    }

    private async Task HandleAsync(UdpClient udp, UdpReceiveResult received, CancellationToken token)
    {
        string id = "";
        bool ok = false;
        string reply;
        try
        {
            using var doc = JsonDocument.Parse(received.Buffer);
            var root = doc.RootElement;
            id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
            var cmd = (root.TryGetProperty("cmd", out var cmdEl) ? cmdEl.GetString() : null)?.Trim() ?? "";

            if (cmd == "howler:stop")
            {
                // Parada limpia del servidor, pedida desde dentro (sin trucos de consola en Windows).
                Log.Information("[Howler] parada del servidor pedida desde el panel");
                ok = true;
                reply = "El servidor se está parando.";
                _ = Task.Run(async () => { await Task.Delay(500); _lifetime.StopApplication(); });
            }
            else if (!cmd.StartsWith('/') || cmd.Length < 2 || char.IsWhiteSpace(cmd[1]) || cmd.Length > MaxCommandLength || cmd.Contains('\n') || cmd.Contains('\r'))
            {
                reply = "Orden no válida.";
            }
            else
            {
                var name = cmd[1..].Split(' ', 2, StringSplitOptions.RemoveEmptyEntries)[0];
                if (!Allowed.Contains(name))
                {
                    reply = $"El comando /{name} no está permitido desde el panel.";
                }
                else
                {
                    var lines = new List<string>();
                    var context = new HowlerCommandContext(_entryCars, _services, lines.Add);
                    Log.Information("[Howler] panel: {Command}", cmd);
                    // El servidor quita la barra antes de ejecutar un comando de chat; aquí se hace igual.
                    await _chat.ProcessCommandAsync(context, cmd[1..]);
                    reply = string.Join("\n", lines);
                    ok = true;
                }
            }
        }
        catch (Exception e)
        {
            Log.Warning(e, "[Howler] orden del panel fallida");
            reply = "Error al ejecutar la orden.";
        }

        try
        {
            var data = JsonSerializer.SerializeToUtf8Bytes(new { v = 1, t = "result", id, ok, reply });
            await udp.SendAsync(data, received.RemoteEndPoint, token);
        }
        catch (Exception e)
        {
            Log.Debug(e, "[Howler] no se pudo responder a la orden");
        }
    }
}

/// <summary>Contexto de comandos con permisos de administrador cuyas respuestas se devuelven al panel.</summary>
public class HowlerCommandContext(EntryCarManager entryCars, IServiceProvider services, Action<string> onReply)
    : BaseCommandContext(entryCars, services)
{
    public override bool IsAdministrator => true;

    public override void Reply(string message) => onReply(message);

    public override void Broadcast(string message)
    {
        base.Broadcast(message);
        onReply(message);
    }
}
