const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

const ChatType = {
    LOCAL: "LOCAL",
    TEAM: "TEAM",
    SERVER: "SERVER",
    ALL: "ALL"
};

// Store spawn binds separately
const guildSpawnBinds = new Map();
const spawnCooldowns = new Map();
let positionResponseHandler = null;

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

function formatPlayerName(name) {
    name = name.replace(/^["']|["']$/g, "");
    if (name.includes(" ") && !name.startsWith('"')) {
        name = `"${name}"`;
    }
    return name;
}

function formatPosition(posString) {
    const matches = posString.match(/\(([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\)/);
    if (!matches) {
        console.error(`Failed to parse position string: ${posString}`);
        return null;
    }
    return `${matches[1]},${matches[2]},${matches[3]}`;
}

function formatCooldown(milliseconds) {
    const days = Math.floor(milliseconds / (24 * 60 * 60 * 1000));
    const hours = Math.floor((milliseconds % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
    return `${days}:${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function saveSpawnBindsToFile() {
    const data = {};
    for (const [guildId, guildData] of guildSpawnBinds.entries()) {
        data[guildId] = {};
        for (const [serverId, binds] of guildData.entries()) {
            data[guildId][serverId] = binds;
        }
    }
    fs.writeFileSync('spawnbinds.json', JSON.stringify(data, null, 2));
}

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
        console.error('Error loading spawn binds:', error);
    }
}

async function handleSpawnBindAdd(interaction) {
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

    const embed = new EmbedBuilder()
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
        );

    await interaction.reply({ embeds: [embed] });
}

async function handleSpawnBindRemove(interaction) {
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

    const embed = new EmbedBuilder()
        .setTitle('Spawn Bind Removed')
        .setColor(0x00ae86)
        .setDescription(`Successfully removed spawn bind for message: ${removed.message}`);

    await interaction.reply({ embeds: [embed] });
}

async function handleSpawnBindList(interaction) {
    const server = interaction.options.getString('server');
    const guildId = interaction.guildId;

    const guildData = guildSpawnBinds.get(guildId);
    if (!guildData || !guildData.has(server)) {
        await interaction.reply('No spawn binds found for this server.');
        return;
    }

    const binds = guildData.get(server);
    const embed = new EmbedBuilder()
        .setTitle(`Spawn Binds for ${server}`)
        .setColor(0x00ae86);

    if (binds.length === 0) {
        embed.setDescription('No spawn binds configured');
    } else {
        binds.forEach((bind, index) => {
            embed.addFields({
                name: `${index + 1}. ${bind.message}`,
                value: `Entity: ${bind.entity}\nChat Type: ${bind.chatType}\nCooldown: ${bind.cooldown / 60000} minutes\nRole: ${bind.roleId ? `<@&${bind.roleId}>` : 'None'}\nRemove Role: ${bind.removeRole ? 'Yes' : 'No'}`,
                inline: false
            });
        });
    }

    await interaction.reply({ embeds: [embed] });
}

async function checkSpawnBinds(message, guildId, serverId, executeCommand) {
    if (!guildSpawnBinds.has(guildId) || !guildSpawnBinds.get(guildId).has(serverId)) {
        return;
    }

    const binds = guildSpawnBinds.get(guildId).get(serverId);
    const [chatType, playerName, chatMessage] = message.match(/\[CHAT\s+([^\]]+)\]\s+([^:]+)\s*:\s*(.+)/i).slice(1);
    const trimmedPlayerName = formatPlayerName(playerName.trim());
    const content = chatMessage.toLowerCase();

    for (const bind of binds) {
        if (bind.chatType !== 'ALL' && bind.chatType !== chatType.toUpperCase()) {
            continue;
        }

        if (content.includes(bind.message.toLowerCase())) {
            const cooldownKey = `${guildId}_${serverId}_${trimmedPlayerName}_${bind.message}`;
            const lastUsed = spawnCooldowns.get(cooldownKey) || 0;
            const now = Date.now();

            if (now - lastUsed < bind.cooldown) {
                const remainingTime = formatCooldown(bind.cooldown - (now - lastUsed));
                if (bind.cooldownMsg) {
                    const cooldownMessage = bind.cooldownMsg
                        .replace('{PlayerName}', trimmedPlayerName)
                        .replace('{Cooldown}', remainingTime);
                    await executeCommand(`say "${cooldownMessage}"`);
                }
                return;
            }

            // Get player position
            await executeCommand(`printpos ${trimmedPlayerName}`);

            // Set up position response handler
            const positionPromise = new Promise((resolve) => {
                positionResponseHandler = (log) => {
                    if (log.includes('(') && log.includes(')')) {
                        const position = formatPosition(log);
                        if (position) {
                            resolve(position);
                            return true;
                        }
                    }
                    return false;
                };
            });

            // Wait for position with timeout
            const position = await Promise.race([
                positionPromise,
                new Promise((_, reject) => setTimeout(() => reject('Position timeout'), 5000))
            ]).catch(() => null);

            positionResponseHandler = null;

            if (position) {
                // Spawn entity at player's position
                await executeCommand(`spawn ${bind.entity} ${position}`);

                if (bind.claimMsg) {
                    const claimMessage = bind.claimMsg.replace('{PlayerName}', trimmedPlayerName);
                    await executeCommand(`say "${claimMessage}"`);
                }

                spawnCooldowns.set(cooldownKey, now);
            }
        }
    }
}

function getSpawnBinds(guildId, serverId) {
    if (!guildSpawnBinds.has(guildId) || !guildSpawnBinds.get(guildId).has(serverId)) {
        return [];
    }
    return guildSpawnBinds.get(guildId).get(serverId);
}

// Function to handle position responses
function handleConsoleLog(log) {
    if (positionResponseHandler) {
        return positionResponseHandler(log);
    }
    return false;
}

module.exports = {
    handleSpawnBindAdd,
    handleSpawnBindRemove,
    handleSpawnBindList,
    checkSpawnBinds,
    loadSpawnBindsFromFile,
    saveSpawnBindsToFile,
    getSpawnBinds,
    handleConsoleLog
}; 