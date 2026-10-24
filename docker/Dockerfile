# Howler + AssettoServer en una sola imagen (Linux x64/arm64).
#   1) Descarga el paquete de Linux de la release (Howler-X.Y.Z-linux.tar.gz) y ponlo en esta carpeta como howler-linux.tar.gz
#   2) docker compose up -d --build        (mira docker-compose.yml y la sección «Docker» de docs/LINUX.md)
FROM node:24-slim AS assetto
ARG TARGETARCH
ARG ASSETTO_X64_SHA=ffb789ad60919281ab45ff3953661cabf2997c7a8b72c3f2b529945626c90435
ARG ASSETTO_ARM64_SHA=ade2098454b4a9b3036f9e2477d3161cfc51a157fb7a3b0991c8f805f5ee8a97
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "$TARGETARCH" in arm64) A=arm64; SHA="$ASSETTO_ARM64_SHA" ;; *) A=x64; SHA="$ASSETTO_X64_SHA" ;; esac; \
    curl -fsSL -o /tmp/a.tgz "https://github.com/compujuckel/AssettoServer/releases/download/v0.0.55-pre35/assetto-server-linux-$A.tar.gz"; \
    echo "$SHA  /tmp/a.tgz" | sha256sum -c -; \
    mkdir -p /opt/assetto && tar -xzf /tmp/a.tgz -C /opt/assetto

FROM node:24-slim
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    HOWLER_HOME=/state \
    HOWLER_CONFIG=/state/howler.config.json
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates procps && rm -rf /var/lib/apt/lists/*
COPY --from=assetto /opt/assetto /opt/assetto
ADD howler-linux.tar.gz /opt/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
VOLUME ["/state", "/server"]
EXPOSE 8420 8421 9600 8081
ENTRYPOINT ["docker-entrypoint.sh"]
