/**
 * Spawn Binds Management Module
 * 
 * Description of Changes:
 * - Added detailed comments for better readability.
 * - Introduced error logging using Discord Webhooks.
 * - Enhanced error handling with try-catch blocks.
 * - Optimized data loading and saving mechanisms.
 * 
 * Author: [Your Name]
 * Timestamp: [Current Date and Time]
 */

const { EmbedBuilder, WebhookClient } = require('discord.js');
const fs = require('fs');

const ChatType = {
    LOCAL: "LOCAL",
    TEAM: "TEAM",
    SERVER: "SERVER",
    ALL: "ALL"
};

const guildSpawnBinds = new Map();
const spawnCooldowns = new Map();
let positionResponseHandler = null;
const errorWebhook = new WebhookClient({ url: 'YOUR_DISCORD_WEBHOOK_URL' });

/**
 * Logs errors and sends them to a Discord webhook for monitoring.
 * @param {string} message - Description of the error.
 * @param {Error} error - The error object.
 */
function logError(message, error) {
    console.error(message, error);
    errorWebhook.send(`**Error:** ${message}\n\`${error?.stack || error}\``);
}

/**
 * Initializes spawn binds storage for a specific guild and server.
 */
function initializeSpawnBinds(guildId, serverId) {
    if (!guildSpawnBinds.has(guildId)) {
        guildSpawnBinds.set(guildId, new Map());
    }
    const guildData = guildSpawnBinds.get(guildId);
    if (!guildData.has(serverId)) {
        guildData.set(serverId, []);
    }
    return guildData.get(serverId);
}

/**
 * Formats cooldown time into a readable string.
 */
function formatCooldown(milliseconds) {
    const days = Math.floor(milliseconds / (24 * 60 * 60 * 1000));
    const hours = Math.floor((milliseconds % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
    return `${days}:${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Saves spawn binds to a file to persist data.
 */
function saveSpawnBindsToFile() {
    try {
        const data = {};
        for (const [guildId, guildData] of guildSpawnBinds.entries()) {
            data[guildId] = {};
            for (const [serverId, binds] of guildData.entries()) {
                data[guildId][serverId] = binds;
            }
        }
        fs.writeFileSync('spawnbinds.json', JSON.stringify(data, null, 2));
    } catch (error) {
        logError("Error saving spawn binds to file", error);
    }
}

/**
 * Loads spawn binds from a file on startup.
 */
function loadSpawnBindsFromFile() {
    try {
        if (fs.existsSync('spawnbinds.json')) {
            const data = JSON.parse(fs.readFileSync('spawnbinds.json', 'utf8'));
            guildSpawnBinds.clear();
            for (const [guildId, guildData] of Object.entries(data)) {
                const guildMap = new Map();
                for (const [serverId, binds] of Object.entries(guildData)) {
                    guildMap.set(serverId, binds);
                }
                guildSpawnBinds.set(guildId, guildMap);
            }
        }
    } catch (error) {
        logError("Error loading spawn binds from file", error);
    }
}

/**
 * Handles the addition of a new spawn bind.
 */
async function handleSpawnBindAdd(interaction) {
    try {
        const server = interaction.options.getString('server');
        const message = interaction.options.getString('message');
        const entity = interaction.options.getString('entity');
        const cooldown = interaction.options.getInteger('cooldown') || 0;
        const role = interaction.options.getRole('required_role');
        const removeRole = interaction.options.getBoolean('remove_role') || false;
        const cooldownMsg = interaction.options.getString('cooldown_message');
        const claimMsg = interaction.options.getString('claim_message');
        const chatType = interaction.options.getString('chat_type') || ChatType.ALL;

        const guildId = interaction.guildId;
        const binds = initializeSpawnBinds(guildId, server);

        binds.push({
            message,
            entity,
            cooldown: cooldown * 60 * 1000,
            roleId: role?.id,
            removeRole,
            cooldownMsg,
            claimMsg,
            chatType
        });

        saveSpawnBindsToFile();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Spawn Bind Added')
                    .setColor(0x00ae86)
                    .addFields(
                        { name: 'Server', value: server, inline: true },
                        { name: 'Trigger Message', value: message, inline: true },
                        { name: 'Entity', value: entity, inline: true },
                        { name: 'Chat Type', value: chatType, inline: true },
                        { name: 'Cooldown', value: cooldown ? `${cooldown} minutes` : 'None', inline: true },
                        { name: 'Required Role', value: role ? role.name : 'None', inline: true },
                        { name: 'Remove Role', value: removeRole ? 'Yes' : 'No', inline: true }
                    )
            ]
        });
    } catch (error) {
        logError("Error handling spawn bind addition", error);
        await interaction.reply({ content: "❌ Failed to add spawn bind. Please try again.", ephemeral: true });
    }
}

/**
 * Handles the removal of an existing spawn bind.
 */
async function handleSpawnBindRemove(interaction) {
    try {
        const server = interaction.options.getString('server');
        const index = interaction.options.getInteger('index') - 1;
        const guildId = interaction.guildId;

        const guildData = guildSpawnBinds.get(guildId);
        if (!guildData || !guildData.has(server)) {
            await interaction.reply('❌ No spawn binds found for this server.');
            return;
        }

        const binds = guildData.get(server);
        if (index < 0 || index >= binds.length) {
            await interaction.reply('❌ Invalid bind index.');
            return;
        }

        const removed = binds.splice(index, 1)[0];
        saveSpawnBindsToFile();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Spawn Bind Removed')
                    .setColor(0x00ae86)
                    .setDescription(`Successfully removed spawn bind for message: ${removed.message}`)
            ]
        });
    } catch (error) {
        logError("Error handling spawn bind removal", error);
        await interaction.reply({ content: "❌ Failed to remove spawn bind.", ephemeral: true });
    }
}

module.exports = { handleSpawnBindAdd, handleSpawnBindRemove, loadSpawnBindsFromFile, saveSpawnBindsToFile, logError };
