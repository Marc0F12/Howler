using AssettoServer.Server.Plugin;
using Autofac;
using Microsoft.Extensions.Hosting;

namespace HowlerPlugin;

public class HowlerModule : AssettoServerModule<HowlerConfiguration>
{
    protected override void Load(ContainerBuilder builder)
    {
        builder.RegisterType<HowlerForwarder>().AsSelf().As<IHostedService>().SingleInstance();
        builder.RegisterType<HowlerCommands>().AsSelf().As<IHostedService>().SingleInstance();
        builder.RegisterType<HowlerClientTelemetry>().AsSelf().As<IHostedService>().SingleInstance();
    }
}
