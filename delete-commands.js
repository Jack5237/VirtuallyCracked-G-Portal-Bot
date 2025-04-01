const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Delete all commands from a specific guild
(async () => {
  try {
    console.log('Started deleting application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] },
    );

    console.log('Successfully deleted all application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})(); 