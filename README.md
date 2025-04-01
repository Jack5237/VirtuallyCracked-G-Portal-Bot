# Discord Bot for Game Server Management

A powerful Discord bot designed to manage game servers, handle player interactions, and provide various administrative features.

## Features

- **Server Management**
  - Server status monitoring
  - Player tracking
  - Automated teleportation system
  - Custom bind system for server commands
  - Spawn bind management

- **Player Features**
  - Player linking system (Discord to game accounts)
  - Role management
  - Cooldown tracking
  - Custom quick chat bindings

- **Administrative Tools**
  - Server configuration management
  - Player activity monitoring
  - Custom command bindings
  - Automated event management

## Prerequisites

- Node.js (v14 or higher)
- Discord Bot Token
- GPortal Account (for server management)
- Discord Server with appropriate permissions

## Installation

1. Clone the repository:
```bash
git clone <your-repository-url>
cd <repository-name>
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your credentials:
     ```
     DISCORD_TOKEN=your_discord_token_here
     GPORTAL_USERNAME=your_gportal_username_here
     GPORTAL_PASSWORD=your_gportal_password_here
     CLIENT_ID=your_client_id_here
     GUILD_ID=your_guild_id_here
     ```

4. Register Discord commands:
```bash
node register-commands.js
```

## Usage

1. Start the bot:
```bash
node index.js
```

2. The bot will automatically connect to Discord and begin monitoring your configured servers.

## Configuration Files

### servers.json
- Contains server configurations
- Maps Discord guilds to game servers
- Stores server nicknames, IDs, and colors
- Manages auto-teleport settings
- Configures gun game settings

### binds.json
- Stores custom command bindings
- Manages cooldown settings
- Configures chat messages and responses

### spawnbinds.json
- Manages spawn-related bindings
- Configures spawn cooldowns
- Sets up spawn-related messages

### cooldowns.json
- Tracks command cooldowns
- Stores player-specific cooldown timestamps

## Commands

The bot supports various commands for server management and player interaction. Use `/help` in Discord to see available commands.

## Security Notes

- Never share your `.env` file or expose your bot token
- Keep your GPortal credentials secure
- Regularly update your bot's permissions and roles
- Monitor command usage and cooldowns

## Support

For support or questions, please create an issue in the repository or contact the bot administrator.

## License

[Your chosen license]

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 