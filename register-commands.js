const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Define your commands
const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a new server')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('The server ID')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('nickname')
        .setDescription('A friendly name for the server')
        .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('run')
    .setDescription('Run a command on server(s)')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('The command to run')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('server')
        .setDescription('The server nickname (leave empty to run on all servers)')
        .setRequired(false)
        .setAutocomplete(true)
    ),
  
  new SlashCommandBuilder()
    .setName('category')
    .setDescription('Manage AutoTP categories')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new AutoTP category')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Category name')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('bind')
            .setDescription('Quick chat bind for this category')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('command')
            .setDescription('Command to execute after teleport (e.g., "kit give {PlayerName} pvp")')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a category')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Category name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all categories')
    ),

  new SlashCommandBuilder()
    .setName('autotp')
    .setDescription('Configure Auto TP settings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable Auto TP')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Turn Auto TP on or off')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a teleport location')
        .addStringOption(option =>
          option.setName('category')
            .setDescription('Category to add this location to')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Location name')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('coordinates')
            .setDescription('Coordinates (format: x,y,z)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a player from Auto TP')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Location name')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all Auto TP players and their coordinates')
    ),

  new SlashCommandBuilder()
    .setName('tpmessage')
    .setDescription('Configure AutoTP messages for a category')
    .addStringOption(option =>
      option.setName('category')
        .setDescription('The category to set messages for')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('signup')
        .setDescription('Message to send when player signs up (use {PlayerName} as placeholder)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('exit')
        .setDescription('Message to send when player exits AutoTP (use {PlayerName} as placeholder)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a server')
    .addStringOption(option =>
      option.setName('server')
        .setDescription('The server nickname to remove')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('gungame')
    .setDescription('Manage Gun Game settings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable Gun Game for a category')
        .addStringOption(option =>
          option.setName('category')
            .setDescription('The teleport category to enable/disable Gun Game for')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Turn Gun Game on or off')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('weapon')
        .setDescription('Add a weapon to the Gun Game progression')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Weapon name/ID')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('kills')
            .setDescription('Number of kills required to advance')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option.setName('ammo')
            .setDescription('Ammo type and amount (e.g., "ammo.rifle 100")')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a weapon from the Gun Game progression')
        .addIntegerOption(option =>
          option.setName('index')
            .setDescription('The index of the weapon to remove')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all weapons in the Gun Game progression')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset')
        .setDescription('Reset all Gun Game weapons and progress')
    ),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your in-game name')
    .addStringOption(option =>
      option.setName('gamertag')
        .setDescription('Your in-game name')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('console')
        .setDescription('Your console platform')
        .setRequired(true)
        .addChoices(
          { name: 'PlayStation', value: 'PlayStation' },
          { name: 'Xbox', value: 'Xbox' }
        )
    ),

  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink a Discord account from their in-game name (Admin only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The Discord user to unlink')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('linkrole')
    .setDescription('Set the role given to linked players (Admin only)')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to give to linked players')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('bind')
    .setDescription('Manage chat binds')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a new chat bind')
            .addStringOption(option =>
                option.setName('server')
                    .setDescription('The server to add the bind to')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('Type of bind')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Command', value: 'command' },
                        { name: 'Spawn', value: 'spawn' }
                    )
            )
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('The message to trigger the bind')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('command')
                    .setDescription('The command to execute (for command type)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('entity')
                    .setDescription('The entity to spawn (for spawn type)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('chat_type')
                    .setDescription('The chat type to listen for')
                    .setRequired(false)
                    .addChoices(
                        { name: 'All', value: 'ALL' },
                        { name: 'Local', value: 'LOCAL' },
                        { name: 'Team', value: 'TEAM' },
                        { name: 'Server', value: 'SERVER' }
                    )
            )
            .addIntegerOption(option =>
                option.setName('cooldown')
                    .setDescription('Cooldown in minutes')
                    .setRequired(false)
            )
            .addRoleOption(option =>
                option.setName('required_role')
                    .setDescription('Role required to use this bind')
                    .setRequired(false)
            )
            .addBooleanOption(option =>
                option.setName('remove_role')
                    .setDescription('Remove the role after execution')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('cooldown_message')
                    .setDescription('Message to show during cooldown')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('claim_message')
                    .setDescription('Message to show when claimed')
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a chat bind')
            .addStringOption(option =>
                option.setName('server')
                    .setDescription('The server to remove the bind from')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addIntegerOption(option =>
                option.setName('index')
                    .setDescription('The index of the bind to remove')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all chat binds')
            .addStringOption(option =>
                option.setName('server')
                    .setDescription('The server to list binds for')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    ),

  new SlashCommandBuilder()
    .setName('resetcooldown')
    .setDescription('Reset bind cooldown for a player (Admin only)')
    .addStringOption(option =>
        option.setName('server')
            .setDescription('The server to reset cooldown for')
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(option =>
        option.setName('player')
            .setDescription('Player name to reset cooldown for')
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName('bind')
            .setDescription('The bind to reset (leave empty for all binds)')
            .setRequired(false)
            .setAutocomplete(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Register commands to a specific guild (server)
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})(); 