using AssettoServer.Server.Configuration;
using FluentValidation;
using JetBrains.Annotations;
using YamlDotNet.Serialization;

namespace HowlerPlugin;

[UsedImplicitly(ImplicitUseKindFlags.Assign, ImplicitUseTargetFlags.WithMembers)]
public class HowlerConfiguration : IValidateConfiguration<HowlerConfigurationValidator>
{
    [YamlMember(Description = "Dirección donde escucha Howler (normalmente este mismo PC)")]
    public string Host { get; init; } = "127.0.0.1";

    [YamlMember(Description = "Puerto UDP donde escucha Howler para los sectores (debe coincidir con acsp.pluginPort en howler.config.json)")]
    public int Port { get; init; } = 12001;

    [YamlMember(Description = "Cuántas veces por segundo se manda a Howler el acelerador, el freno, el volante y la orientación de cada coche (para las gráficas del comparador de vueltas). 0 = desactivado")]
    public int TelemetryHz { get; init; } = 10;

    [YamlMember(Description = "Puerto UDP (solo 127.0.0.1) donde el plugin recibe las órdenes del panel de Howler: hora, clima, lastre... 0 = desactivado")]
    public int CommandPort { get; init; } = 12002;

    [YamlMember(Description = "Reparte a los clientes con CSP un script que manda el pedal de freno real, la aceleración y datos de las ruedas (necesita EnableClientMessages: true en extra_cfg.yml). Los datos salen del PC de cada jugador y solo los mandan los que tienen CSP. false = desactivado")]
    public bool ClientTelemetry { get; init; } = true;
}

public class HowlerConfigurationValidator : AbstractValidator<HowlerConfiguration>
{
    public HowlerConfigurationValidator()
    {
        RuleFor(cfg => cfg.Host).NotEmpty();
        RuleFor(cfg => cfg.Port).InclusiveBetween(1, 65535);
        RuleFor(cfg => cfg.CommandPort).InclusiveBetween(0, 65535);
        RuleFor(cfg => cfg.TelemetryHz).InclusiveBetween(0, 30);
    }
}
