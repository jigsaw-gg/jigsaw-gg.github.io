fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Serde only on unary lobby/relay messages used by the :21100 HTTP API.
    // Avoid StreamFrame oneofs (serde + prost oneof is painful).
    const SERDE: &str = "#[derive(::serde::Serialize, ::serde::Deserialize)]";
    const CAMEL: &str = "#[serde(rename_all = \"camelCase\")]";
    const DEFAULT: &str = "#[serde(default)]";

    let unary_messages = [
        // game.v1 lobby
        ".game.v1.PuzzleSetup",
        ".game.v1.CreateGameRequest",
        ".game.v1.CreateGameResponse",
        ".game.v1.GetGameRequest",
        ".game.v1.GetGameResponse",
        ".game.v1.JoinGameRequest",
        ".game.v1.JoinGameResponse",
        ".game.v1.LeaveGameRequest",
        ".game.v1.LeaveGameResponse",
        ".game.v1.PlayEndpoints",
        ".game.v1.PlayerInfo",
        ".game.v1.BoardSnapshot",
        ".game.v1.PieceState",
        // relay.v1
        ".relay.v1.PingRequest",
        ".relay.v1.PongResponse",
    ];

    let mut builder = tonic_prost_build::configure()
        .build_server(false)
        .build_client(false);

    for path in unary_messages {
        builder = builder
            .type_attribute(path, SERDE)
            .type_attribute(path, CAMEL)
            .type_attribute(path, DEFAULT);
    }

    builder.compile_protos(
        &["../../proto/relay.proto", "../../proto/game.proto"],
        &["../../proto"],
    )?;
    Ok(())
}
