const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const { v4: uuidv4 } = require('uuid');

// Add enums from original
const ChatType = {
  LOCAL: "LOCAL",
  TEAM: "TEAM",
  SERVER: "SERVER",
  ALL: "ALL",
};

const BindType = {
  COMMAND: "command",
  SPAWN: "spawn",
};

// Store binds with enhanced structure
const guildBinds = new Map();
const bindCooldowns = new Map();
const COOLDOWNS_FILE = 'cooldowns.json';

let getGuildServersFunc; // Add at the top with other variables
let positionResponseHandler = null;
let lastPositionResponse = null;
let currentPositionHandler = null;

// Update the position tracking
let positionRequests = new Map(); // Map to store UUID -> resolver function

// Add at the top with other Maps
const messageProcessing = new Map(); // Track players currently being processed: guildId_serverId_playerName -> timestamp
const commandQueue = new Map(); // Store queued commands: guildId_serverId -> Array<{command, playerName, bind}>
const QUEUE_PROCESS_INTERVAL = 500; // Process queue every 500ms

// Add this function to initialize the getGuildServers reference
function initialize(getGuildServers, discordClient, playerLinksMap) {
    getGuildServersFunc = getGuildServers;
    client = discordClient;
    playerLinks = playerLinksMap; // Store the playerLinks map
    loadCooldownsFromFile(); // Load cooldowns during initialization
}

function initializeBinds(guildId, serverId) {
  if (!guildBinds.has(guildId)) {
    guildBinds.set(guildId, new Map());
  }
  const guildData = guildBinds.get(guildId);
  if (!guildData.has(serverId)) {
    guildData.set(serverId, []);
  }
  return guildData.get(serverId);
}

// Add utility functions from original
function formatPlayerName(name) {
  // Remove any leading/trailing quotes and spaces
  name = name.replace(/^["'\s]+|["'\s]+$/g, "");

  // If name contains spaces and isn't already quoted, add quotes
  if (name.includes(" ") && !name.startsWith('"')) {
    name = `"${name}"`;
  }

  // Handle special characters and spaces properly
  name = name.replace(/[""]/g, '"'); // Replace smart quotes with straight quotes

  // If name isn't quoted and contains special characters, add quotes
  if (!name.startsWith('"') && /[^a-zA-Z0-9-]/.test(name)) {
    name = `"${name}"`;
  }

  return name;
}

function formatPosition(posString) {
  const matches = posString.match(
    /\(([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\)/
  );
  if (!matches) {
    console.error(`Failed to parse position string: ${posString}`);
    return null;
  }
  return `(${matches[1]},${matches[2]},${matches[3]})`;
}

function formatCooldown(milliseconds) {
  const days = Math.floor(milliseconds / (24 * 60 * 60 * 1000));
  const hours = Math.floor(
    (milliseconds % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)
  );
  const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
  return `${days}:${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
}

function saveBindsToFile() {
  const data = {};
  for (const [guildId, guildData] of guildBinds.entries()) {
    data[guildId] = {};
    for (const [serverId, binds] of guildData.entries()) {
      data[guildId][serverId] = binds;
    }
  }
  fs.writeFileSync("binds.json", JSON.stringify(data, null, 2));
  console.log("Binds saved:".green, JSON.stringify(data, null, 2));
}

function loadBindsFromFile() {
  try {
    console.log('Loading binds from file...'.cyan);
    if (fs.existsSync('binds.json')) {
      const data = JSON.parse(fs.readFileSync('binds.json', 'utf8'));
      console.log('Loaded bind data:'.cyan, JSON.stringify(data, null, 2));
      
      guildBinds.clear();
      console.log('Cleared existing binds'.cyan);

      for (const [guildId, guildData] of Object.entries(data)) {
        console.log(`Processing guild ${guildId}`.cyan);
        const guildMap = new Map();
        
        for (const [serverId, binds] of Object.entries(guildData)) {
          console.log(`Processing server ${serverId} with ${binds.length} binds`.cyan);
          guildMap.set(serverId, binds);
        }
        
        guildBinds.set(guildId, guildMap);
      }

      console.log('Final bind state:'.cyan);
      for (const [guildId, guildMap] of guildBinds.entries()) {
        for (const [serverId, binds] of guildMap.entries()) {
          console.log(`Guild ${guildId}, Server ${serverId}: ${binds.length} binds`.cyan);
          binds.forEach((bind, index) => {
            console.log(`  ${index + 1}. ${bind.message} -> ${bind.command}`.cyan);
          });
        }
      }
      
      console.log('Binds loaded successfully'.green);
    } else {
      console.log('No binds.json file found, starting with empty binds'.yellow);
    }
  } catch (error) {
    console.error('Error loading binds:'.red, error);
  }
}

async function handleBindAdd(interaction, client) {
  const serverNickname = interaction.options.getString('server');
  const guildId = interaction.guildId;

  // Get the actual server ID from the nickname
  const guildData = getGuildServersFunc(guildId);
  const serverId = guildData.nicknames.get(serverNickname);

  if (!serverId) {
    await interaction.reply('❌ Invalid server selected.');
    return;
  }

  const message = interaction.options.getString('message');
  const command = interaction.options.getString('command');
  const entity = interaction.options.getString('entity');
  const cooldown = interaction.options.getInteger('cooldown') || 0;
  const role = interaction.options.getRole('required_role');
  const removeRole = interaction.options.getBoolean('remove_role') || false;
  const cooldownMsg = interaction.options.getString('cooldown_message');
  const claimMsg = interaction.options.getString('claim_message');
  const chatType = interaction.options.getString('chat_type') || ChatType.ALL;
  const type = entity ? BindType.SPAWN : BindType.COMMAND;

  const binds = initializeBinds(guildId, serverId);

  binds.push({
    message,
    command: type === BindType.SPAWN ? null : command,
    entity: type === BindType.SPAWN ? entity : null,
    cooldown: cooldown * 60 * 1000,
    roleId: role?.id,
    removeRole,
    cooldownMsg,
    claimMsg,
    chatType,
    type
  });

  saveBindsToFile();

  const embed = new EmbedBuilder()
    .setTitle('Bind Added')
    .setColor(0x00ae86)
    .addFields(
      { name: 'Server', value: serverNickname, inline: true },
      { name: 'Trigger Message', value: message, inline: true },
      { name: 'Type', value: type, inline: true },
      { 
        name: type === BindType.SPAWN ? 'Entity' : 'Command',
        value: type === BindType.SPAWN ? entity : command,
        inline: true 
      },
      { name: 'Chat Type', value: chatType, inline: true },
      { name: 'Cooldown', value: cooldown ? `${cooldown} minutes` : 'None', inline: true },
      { name: 'Required Role', value: role ? role.name : 'None', inline: true },
      { name: 'Remove Role', value: removeRole ? 'Yes' : 'No', inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleBindRemove(interaction) {
  const serverNickname = interaction.options.getString("server");
  const index = interaction.options.getInteger("index") - 1;
  const guildId = interaction.guildId;

  // Debug logging
  console.log(`Attempting to remove bind - Guild: ${guildId}, Server: ${serverNickname}, Index: ${index}`.cyan);

  // Get the actual server ID from the nickname
  const guildData = getGuildServersFunc(guildId);
  const serverId = guildData.nicknames.get(serverNickname);

  if (!serverId) {
    console.log(`Server ID not found for nickname ${serverNickname}`.red);
    await interaction.reply('❌ Invalid server selected.');
    return;
  }

  // Debug logging
  console.log(`Found server ID: ${serverId}`.cyan);
  console.log(`Current binds:`, guildBinds.get(guildId)?.get(serverId));

  const binds = getBinds(guildId, serverId);
  if (!binds || binds.length === 0) {
    console.log(`No binds found for server ${serverNickname} (${serverId})`.red);
    await interaction.reply("❌ No binds found for this server.");
    return;
  }

  if (index < 0 || index >= binds.length) {
    console.log(`Invalid bind index: ${index} (total binds: ${binds.length})`.red);
    await interaction.reply("❌ Invalid bind index.");
    return;
  }

  // Get the bind before removing it
  const removed = binds.splice(index, 1)[0];
  
  // Make sure to update the stored binds
  const guildBindData = guildBinds.get(guildId) || new Map();
  guildBindData.set(serverId, binds);
  guildBinds.set(guildId, guildBindData);
  
  saveBindsToFile();

  console.log(`Successfully removed bind: ${JSON.stringify(removed)}`.green);

  const embed = new EmbedBuilder()
    .setTitle("Bind Removed")
    .setColor(0x00ae86)
    .setDescription(`Successfully removed bind for message: ${removed.message}`);

  await interaction.reply({ embeds: [embed] });
}

async function handleBindList(interaction) {
  const serverNickname = interaction.options.getString('server');
  const guildId = interaction.guildId;

  // Get the actual server ID from the nickname
  const guildData = getGuildServersFunc(guildId);
  const serverId = guildData.nicknames.get(serverNickname);

  if (!serverId) {
    await interaction.reply('❌ Invalid server selected.');
    return;
  }

  const guildBindData = guildBinds.get(guildId);
  if (!guildBindData || !guildBindData.has(serverId)) {
    await interaction.reply('No binds found for this server.');
    return;
  }

  const binds = guildBindData.get(serverId);
  const embed = new EmbedBuilder()
    .setTitle(`Binds for ${serverNickname}`)
    .setColor(0x00ae86);

  if (binds.length === 0) {
    embed.setDescription('No binds configured');
  } else {
    binds.forEach((bind, index) => {
      const isSpawn = bind.type === BindType.SPAWN;
      embed.addFields({
        name: `${index + 1}. ${bind.message} (${bind.type})`,
        value: `${isSpawn ? 'Entity' : 'Command'}: ${isSpawn ? bind.entity : bind.command}\n` +
               `Cooldown: ${bind.cooldown / 60000} minutes\n` +
               `Role: ${bind.roleId ? `<@&${bind.roleId}>` : 'None'}\n` +
               `Remove Role: ${bind.removeRole ? 'Yes' : 'No'}`,
        inline: false
      });
    });
  }

  await interaction.reply({ embeds: [embed] });
}

// Add this function to process the command queue
async function processCommandQueue(guildId, serverId, executeCommand) {
    const queueKey = `${guildId}_${serverId}`;
    const queue = commandQueue.get(queueKey) || [];
    
    if (queue.length === 0) return;
    
    const item = queue.shift(); // Get next command in queue
    commandQueue.set(queueKey, queue); // Update queue

    try {
        if (item.bind.type === BindType.SPAWN) {
            await handleSpawnCommand(item, guildId, serverId, executeCommand);
        } else if (item.bind.type === BindType.COMMAND) {
            await handleCommandBind(item, executeCommand);
        }
    } catch (error) {
        console.error(`Error processing queued command:`.red, error);
    }
}

// Add helper functions to handle different bind types
async function handleSpawnCommand(item, guildId, serverId, executeCommand) {
    try {
        console.log(`Getting position for ${item.playerName}...`.cyan);
        const position = await getPlayerPosition(item.playerName, executeCommand);
        
        if (position) {
            console.log(`Got position ${position} for ${item.playerName}, spawning ${item.bind.entity}`.green);
            const spawnCommand = `spawn ${item.bind.entity} ${position}`;
            console.log(`Executing spawn command: ${spawnCommand}`.cyan);
            await executeCommand(spawnCommand);
            
            // Set cooldown AFTER successful spawn
            const cooldownKey = `${guildId}_${serverId}_${item.playerName}_${item.bind.message}`;
            bindCooldowns.set(cooldownKey, Date.now());
            saveCooldownsToFile(); // Save after setting cooldown
            
            if (item.bind.claimMsg) {
                await new Promise(resolve => setTimeout(resolve, 500));
                const claimMessage = item.bind.claimMsg.replace('{PlayerName}', item.playerName);
                await executeCommand(`say "${claimMessage}"`);
            }
        } else {
            console.log(`Failed to get position for ${item.playerName}`.red);
        }
    } catch (error) {
        console.error(`Error in spawn command for ${item.playerName}:`.red, error);
    }
}

// Add this helper function to check roles
async function checkBindRole(bind, guildId, discordId) {
    if (!bind.roleId) return true; // No role requirement
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return false;

        const member = await guild.members.fetch(discordId);
        if (!member) return false;

        return member.roles.cache.has(bind.roleId);
    } catch (error) {
        console.error(`Error checking role for bind:`.red, error);
        return false;
    }
}

// Update the checkBinds function
async function checkBinds(message, guildId, serverId, executeCommand) {
    if (!guildBinds.has(guildId) || !guildBinds.get(guildId).has(serverId)) {
        return;
    }

    try {
        const match = message.match(/\[CHAT\s+([^\]]+)\]\s+([^:]+?)\s*:\s*(.+)/i);
        if (!match) return;

        const [, chatType, rawPlayerName, chatMessage] = match;
        const trimmedPlayerName = formatPlayerName(rawPlayerName.trim());
        const content = chatMessage.toLowerCase().trim();

        // Rest of spam protection logic...
        const processingKey = `${guildId}_${serverId}_${trimmedPlayerName}`;
        const lastProcessed = messageProcessing.get(processingKey);
        const now = Date.now();

        if (lastProcessed && (now - lastProcessed) < 5000) {
            console.log(`Ignoring spam message from ${trimmedPlayerName} (processing cooldown active)`.yellow);
            return;
        }

        messageProcessing.set(processingKey, now);

        try {
            const binds = guildBinds.get(guildId).get(serverId);
            const queueKey = `${guildId}_${serverId}`;
            let queue = commandQueue.get(queueKey) || [];
            
            for (const bind of binds) {
                if (bind.chatType !== 'ALL' && bind.chatType !== chatType.toUpperCase()) continue;
                if (!content.includes(bind.message.toLowerCase())) continue;

                // Only get Discord ID and check role if this specific bind requires it
                if (bind.roleId) {
                    const discordId = Array.from(playerLinks.entries()).find(
                        ([, data]) => formatPlayerName(data.gamertag) === trimmedPlayerName
                    )?.[0];

                    if (!discordId) {
                        console.log(`No linked Discord account found for ${trimmedPlayerName} (bind requires role)`.yellow);
                        continue;
                    }

                    const hasRole = await checkBindRole(bind, guildId, discordId);
                    if (!hasRole) {
                        console.log(`${trimmedPlayerName} doesn't have required role for bind ${bind.message}`.yellow);
                        continue;
                    }
                }

                // Check bind cooldown
                const cooldownKey = `${guildId}_${serverId}_${trimmedPlayerName}_${bind.message}`;
                const lastUsed = bindCooldowns.get(cooldownKey) || 0;
                const cooldownRemaining = bind.cooldown - (now - lastUsed);

                if (cooldownRemaining > 0) {
                    console.log(`Cooldown active for ${trimmedPlayerName} - ${formatCooldown(cooldownRemaining)}`.yellow);
                    if (bind.cooldownMsg) {
                        const cooldownMessage = bind.cooldownMsg
                            .replace('{PlayerName}', trimmedPlayerName)
                            .replace('{Cooldown}', formatCooldown(cooldownRemaining));
                        await executeCommand(`say "${cooldownMessage}"`);
                    }
                    continue;
                }

                // Add command to queue
                queue.push({
                    bind,
                    playerName: trimmedPlayerName,
                    timestamp: now,
                    discordId: bind.roleId ? discordId : undefined // Only include Discord ID if bind has role requirement
                });
                
                console.log(`Added ${bind.type} to queue for ${trimmedPlayerName}`.cyan);
            }

            commandQueue.set(queueKey, queue);
            await processCommandQueue(guildId, serverId, executeCommand);

        } finally {
            setTimeout(() => {
                messageProcessing.delete(processingKey);
            }, 5000);
        }
    } catch (error) {
        console.error("Error in checkBinds:".red, error);
    }
}

// Update handleCommandBind to handle role removal
async function handleCommandBind(item, executeCommand) {
    try {
        const formattedCommand = item.bind.command.replace('{PlayerName}', item.playerName);
        await executeCommand(formattedCommand);
        
        // Handle role removal if configured
        if (item.bind.removeRole && item.bind.roleId && item.discordId) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    const member = await guild.members.fetch(item.discordId);
                    if (member) {
                        await member.roles.remove(item.bind.roleId);
                        console.log(`Removed role from ${item.playerName} after bind execution`.cyan);
                    }
                }
            } catch (error) {
                console.error(`Failed to remove role from ${item.playerName}:`.red, error);
            }
        }

        if (item.bind.claimMsg) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const claimMessage = item.bind.claimMsg.replace('{PlayerName}', item.playerName);
            await executeCommand(`say "${claimMessage}"`);
        }
    } catch (error) {
        console.error(`Error in command bind:`.red, error);
    }
}

// Add an interval to process queues regularly
setInterval(() => {
    for (const [queueKey, queue] of commandQueue.entries()) {
        if (queue.length > 0) {
            const [guildId, serverId] = queueKey.split('_');
            processCommandQueue(guildId, serverId, executeCommand);
        }
    }
}, QUEUE_PROCESS_INTERVAL);

// Add this function to expose binds for autocomplete
function getBinds(guildId, serverId) {
  if (!guildBinds.has(guildId) || !guildBinds.get(guildId).has(serverId)) {
    return [];
  }
  return guildBinds.get(guildId).get(serverId);
}

// Add at the top with other variables
let lastPosition = null;
let lastSpwnId = null;

function resetCooldown(cooldownKey) {
    console.log(`Resetting cooldown for key: ${cooldownKey}`.cyan);
    
    if (bindCooldowns.has(cooldownKey)) {
        bindCooldowns.delete(cooldownKey);
        saveCooldownsToFile();
        console.log(`Successfully reset cooldown and saved to file`.green);
    } else {
        console.log(`No active cooldown found for key: ${cooldownKey}`.yellow);
    }
}

// Add this function near the other helper functions
async function getPlayerPosition(playerName, executeCommand) {
    return new Promise((resolve, reject) => {
        let positionHandler;
        const timeout = setTimeout(() => {
            client.removeListener('consoleLog', positionHandler);
            reject(new Error('Position request timed out'));
        }, 5000);

        positionHandler = (log) => {
            const match = log.match(/\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
            if (match) {
                const [, x, y, z] = match;
                clearTimeout(timeout);
                client.removeListener('consoleLog', positionHandler);
                resolve(`${x},${y},${z}`);
                return true;
            }
            return false;
        };

        client.on('consoleLog', positionHandler);
        executeCommand(`printpos ${playerName}`);
    });
}

// Add function to save cooldowns
function saveCooldownsToFile() {
    const cooldowns = {};
    for (const [key, timestamp] of bindCooldowns.entries()) {
        cooldowns[key] = timestamp;
    }
    fs.writeFileSync(COOLDOWNS_FILE, JSON.stringify(cooldowns, null, 2));
    console.log('Cooldowns saved to file'.green);
}

// Add function to load cooldowns
function loadCooldownsFromFile() {
    try {
        if (fs.existsSync(COOLDOWNS_FILE)) {
            const data = JSON.parse(fs.readFileSync(COOLDOWNS_FILE, 'utf8'));
            bindCooldowns.clear();
            
            const now = Date.now();
            // Only load cooldowns that haven't expired
            for (const [key, timestamp] of Object.entries(data)) {
                // Parse the cooldown duration from the key
                const [guildId, serverId, playerName, bindMessage] = key.split('_');
                const bind = getBindForMessage(guildId, serverId, bindMessage);
                
                if (bind && (now - timestamp) < bind.cooldown) {
                    bindCooldowns.set(key, timestamp);
                }
            }
            console.log('Cooldowns loaded from file'.green);
        }
    } catch (error) {
        console.error('Error loading cooldowns:'.red, error);
    }
}

// Helper function to get bind by message
function getBindForMessage(guildId, serverId, message) {
    const binds = getBinds(guildId, serverId);
    return binds?.find(bind => bind.message === message);
}

// Add cooldown save on process exit
process.on('SIGINT', () => {
    saveCooldownsToFile();
    process.exit();
});

module.exports = {
  handleBindAdd,
  handleBindRemove,
  handleBindList,
  checkBinds,
  loadBindsFromFile,
  saveBindsToFile,
  getBinds,
  initialize,
  resetCooldown,
  getPlayerPosition,
  saveCooldownsToFile,
  loadCooldownsFromFile,
};
