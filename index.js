require("dotenv").config();
const colors = require("colors");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const bindSystem = require("./bindSystem");

// In-memory storage
const serverInstances = new Map(); // Store browser/page instances: guildId_serverId -> { browser, page }
const guildServers = new Map(); // Store guild-specific server mappings: guildId -> { nicknames, ids, colors }
const availableColors = ["green", "blue", "yellow", "cyan", "magenta", "red"];
const guildAutoTP = new Map(); // Store AutoTP settings: guildId -> { enabled, players: Map }
const lastTeleported = new Map(); // Store last teleport time: guildId_playerName -> timestamp
const guildGunGame = new Map(); // Store GunGame settings: guildId -> { enabled, weapons: [{weapon, kills}], playerProgress: Map }
const playerLinks = new Map(); // Store player links: discordId -> { gamertag, console, guildId }
const guildLinkRoles = new Map(); // Store link roles: guildId -> roleId
const activeBindRequests = new Map(); // Track active bind processing
const bindQueue = new Map(); // Queue for bind requests
const BIND_TIMEOUT = 5000; // 5 seconds timeout for bind processing

// Initialize the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Define the log area selector
const logAreaSelector =
  "#app > div:nth-child(2) > section > div.tw-px-4.tw-pb-10 > div > div > div:nth-child(2) > div.tw-relative > div > div.tw-flex.tw-max-h-max.tw-flex-col.tw-gap-6.tw-rounded-b-3xl.tw-px-8.md\\:tw-pl-20.md\\:tw-pr-12.tw-mb-6 > div.tw-h-\\[28rem\\].tw-overflow-auto.tw-rounded-md.tw-bg-gp-midnight-1.tw-p-4.tw-shadow-3xl";

// Add near the top of the file
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

// Function to get or create guild server data
function getGuildServers(guildId) {
  if (!guildServers.has(guildId)) {
    guildServers.set(guildId, {
      nicknames: new Map(),
      ids: new Map(),
      colors: new Map(),
    });
  }
  return guildServers.get(guildId);
}

// Function to get server instance key
function getInstanceKey(guildId, serverId) {
  return `${guildId}_${serverId}`;
}

// Function to get or assign a color for a server
function getServerColor(guildId, nickname) {
  const guildData = getGuildServers(guildId);

  if (!guildData.colors.has(nickname)) {
    // Get next available color
    const usedColors = new Set(guildData.colors.values());
    const availableColor =
      availableColors.find((color) => !usedColors.has(color)) ||
      availableColors[0];
    guildData.colors.set(nickname, availableColor);
    saveServersToFile();
  }
  return guildData.colors.get(nickname);
}

// Function to log console entries to a file
async function logAllConsoleEntries(instance, nickname, guildId) {
  try {
    const { page } = instance;
    const serverColor = getServerColor(guildId, nickname);
    const guildData = getGuildServers(guildId);
    const serverId = guildData.nicknames.get(nickname);

    // Create server-specific log array
    const instanceKey = getInstanceKey(guildId, serverId);
    if (!global.serverLogs) global.serverLogs = new Map();
    global.serverLogs.set(instanceKey, []);

    // Wait longer for initial page load
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const appendLogsToFile = (logs, serverKey) => {
      fs.appendFileSync("console_logs.txt", logs.join("\n") + "\n");
      logs.forEach((log) => {
        const serverName = `${nickname}:`.padEnd(8);
        console.log(`${serverName}`.magenta + `${log}`[serverColor]);
      });
    };

    // Create server-specific receiveLogs function
    const receiveLogsFunction = `receiveLogs_${instanceKey.replace(
      /[^a-zA-Z0-9]/g,
      "_"
    )}`;
    await page.exposeFunction(receiveLogsFunction, (logs) => {
      const serverLogs = global.serverLogs.get(instanceKey) || [];
      appendLogsToFile(logs, instanceKey);
      global.serverLogs.set(instanceKey, serverLogs.concat(logs));
      checkLogEntries(logs, guildId, serverId);
    });

    let connectionFailures = 0;
    const maxFailures = 5;

    page._scrapeInterval = setInterval(async () => {
      try {
        if (page.isClosed()) {
          clearInterval(page._scrapeInterval);
          console.log(`${nickname}: Connection closed`.red);
          return;
        }

        const logs = await page.evaluate((selector) => {
          const logArea = document.querySelector(selector);
          if (!logArea) return null;
          const logEntries = logArea.querySelectorAll("div");
          return Array.from(logEntries).map((el) => el.textContent.trim());
        }, logAreaSelector);

        if (logs === null) {
          connectionFailures++;
          console.log(
            `${nickname}: Connection check failed (${connectionFailures}/${maxFailures})`
              .yellow
          );

          if (connectionFailures >= maxFailures) {
            console.log(
              `${nickname}: Lost connection after ${maxFailures} failures`.red
            );
            clearInterval(page._scrapeInterval);
            return;
          }
        } else {
          connectionFailures = 0; // Reset counter on successful connection
          const serverLogs = global.serverLogs.get(instanceKey) || [];
          const newLogs = logs.slice(serverLogs.length);
          if (newLogs.length > 0) {
            await page.evaluate(
              (logs, fnName) => {
                window[fnName](logs);
              },
              newLogs,
              receiveLogsFunction
            );
          }
        }
      } catch (error) {
        console.error(`${nickname}: Error scraping logs`.red, error);
      }
    }, 500);

    console.log(`${nickname}: Started console logging`.green);
  } catch (error) {
    console.error(`${nickname}: Error setting up logging`.red, error);
  }
}

// Function to execute commands
async function executeCommand(instance, command, nickname) {
  try {
    console.log(`${nickname}: Executing command: ${command}`.yellow);

    const { page } = instance;
    const textBoxSelector = "input#text-input__console-input-message";
    await page.waitForSelector(textBoxSelector, { timeout: 5000 });
    await page.focus(textBoxSelector);

    // Clear existing text
    await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      if (input) input.value = "";
    }, textBoxSelector);

    // Type command
    await page.type(textBoxSelector, command);

    // Click send button
    const sendButtonSelector = 'button[type="button"]:not([disabled])';
    await page.waitForSelector(sendButtonSelector, { timeout: 3000 });
    const buttons = await page.$$(sendButtonSelector);
    for (const btn of buttons) {
      const btnText = await page.evaluate((el) => el.textContent, btn);
      if (btnText.trim().toLowerCase() === "send") {
        await btn.click();
        break;
      }
    }

    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`${nickname}: Command executed successfully`.green);
    return "Command executed successfully";
  } catch (error) {
    console.error(`${nickname}: Command execution failed`.red, error);
    return `Error: ${error.message}`;
  }
}

// Update the isAdmin function to properly check Discord administrator permissions
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// Function to save servers to JSON file
function saveServersToFile() {
  const data = {
    guilds: {},
    playerLinks: Array.from(playerLinks.entries()),
    linkRoles: Object.fromEntries(guildLinkRoles.entries()), // Save link roles
  };

  for (const [guildId, serverData] of guildServers.entries()) {
    const autotpData = guildAutoTP.get(guildId) || {
      enabled: false,
      categories: {},
    };

    const gunGameData = guildGunGame.get(guildId) || {
      enabled: false,
      weapons: [],
      playerProgress: new Map(),
    };

    data.guilds[guildId] = {
      nicknames: Array.from(serverData.nicknames.entries()),
      ids: Array.from(serverData.ids.entries()),
      colors: Array.from(serverData.colors.entries()),
      autotp: {
        enabled: autotpData.enabled,
        categories: Object.fromEntries(
          Object.entries(autotpData.categories).map(([name, category]) => [
            name,
            {
              bind: category.bind,
              locations: category.locations || [],
              activePlayers: category.activePlayers || [],
              messages: category.messages || { signup: null, exit: null },
            },
          ])
        ),
      },
      gungame: {
        enabled: gunGameData.enabled,
        weapons: gunGameData.weapons,
        playerProgress: Array.from(gunGameData.playerProgress.entries()),
      },
    };
  }

  fs.writeFileSync("servers.json", JSON.stringify(data, null, 2));
  console.log("Servers data saved to file".green);
}

// Function to load servers from JSON file
function loadServersFromFile() {
  try {
    const data = JSON.parse(fs.readFileSync("servers.json", "utf8"));
    guildServers.clear();
    guildAutoTP.clear();
    guildGunGame.clear();

    for (const [guildId, guildData] of Object.entries(data.guilds)) {
      // Load server data
      const serverData = {
        nicknames: new Map(guildData.nicknames),
        ids: new Map(guildData.ids),
        colors: new Map(guildData.colors),
      };
      guildServers.set(guildId, serverData);

      // Load AutoTP data
      const autotpData = guildData.autotp || {
        enabled: false,
        categories: {},
      };
      guildAutoTP.set(guildId, autotpData);

      // Load GunGame data
      const gunGameData = guildData.gungame || {
        enabled: false,
        weapons: [],
        playerProgress: [],
      };
      guildGunGame.set(guildId, {
        enabled: gunGameData.enabled,
        weapons: gunGameData.weapons,
        playerProgress: new Map(gunGameData.playerProgress),
      });
    }

    // Load player links
    playerLinks.clear();
    if (data.playerLinks) {
      for (const [discordId, linkData] of data.playerLinks) {
        playerLinks.set(discordId, linkData);
      }
    }

    // Load link roles
    guildLinkRoles.clear();
    if (data.linkRoles) {
      for (const [guildId, roleId] of Object.entries(data.linkRoles)) {
        guildLinkRoles.set(guildId, roleId);
      }
    }

    console.log("Servers data loaded from file".green);
    return true;
  } catch (error) {
    console.error("Error loading servers from file:".red, error);
    return false;
  }
}

// Function to initialize a single server
async function initializeServer(guildId, serverId, nickname) {
  try {
    console.log(`Initializing server: ${nickname} for guild: ${guildId}`.cyan);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto("https://www.g-portal.com/", { waitUntil: "networkidle2" });
    await page.goto(
      "https://auth.g-portal.com/auth/realms/master/protocol/openid-connect/auth" +
        "?client_id=website&redirect_uri=https%3A%2F%2Fwww.g-portal.com%2Fint%2Fserver%2F" +
        "rust-console%2F1578031%2Fconsole&state=1c0e41ea-6f5f-4ab5-9441-0bfe9e0c956e" +
        "&response_mode=fragment&response_type=code&scope=openid&nonce=f23cc9e0-8f77-40bc-8aa2-5c1d18a9df78",
      { waitUntil: "networkidle2" }
    );

    await page.type("#username", process.env.GPORTAL_USERNAME);
    await page.type("#password", process.env.GPORTAL_PASSWORD);
    await page.click("#kc-login");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    const serverUrl = `https://www.g-portal.com/int/server/rust-console/${serverId}/console`;
    await page.goto(serverUrl, { waitUntil: "networkidle2" });

    const instanceKey = getInstanceKey(guildId, serverId);
    serverInstances.set(instanceKey, { browser, page });
    const guildData = getGuildServers(guildId);
    guildData.nicknames.set(nickname, serverId);
    guildData.ids.set(serverId, nickname);

    await logAllConsoleEntries({ browser, page }, nickname, guildId);
    saveServersToFile();

    console.log(
      `Successfully initialized ${nickname} for guild: ${guildId}`.green
    );
    return true;
  } catch (error) {
    console.error(
      `Failed to initialize server ${nickname} for guild: ${guildId}:`.red,
      error
    );
    return false;
  }
}

// Update the handleAddServer function
async function handleAddServer(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to add servers.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const guildId = interaction.guildId;
    const serverId = interaction.options.getString("id");
    const nickname = interaction.options.getString("nickname");
    const guildData = getGuildServers(guildId);

    console.log(
      `Attempting to add server: ${nickname} for guild: ${guildId}`.cyan
    );

    // Check if nickname is already in use for this guild
    if (guildData.nicknames.has(nickname)) {
      await interaction.editReply("❌ This nickname is already in use.");
      return;
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Login process
    const page = await browser.newPage();
    await page.goto("https://www.g-portal.com/", { waitUntil: "networkidle2" });
    await page.goto(
      "https://auth.g-portal.com/auth/realms/master/protocol/openid-connect/auth" +
        "?client_id=website&redirect_uri=https%3A%2F%2Fwww.g-portal.com%2Fint%2Fserver%2F" +
        "rust-console%2F1578031%2Fconsole&state=1c0e41ea-6f5f-4ab5-9441-0bfe9e0c956e" +
        "&response_mode=fragment&response_type=code&scope=openid&nonce=f23cc9e0-8f77-40bc-8aa2-5c1d18a9df78",
      { waitUntil: "networkidle2" }
    );

    await page.type("#username", process.env.GPORTAL_USERNAME);
    await page.type("#password", process.env.GPORTAL_PASSWORD);
    await page.click("#kc-login");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // Navigate to server console
    const serverUrl = `https://www.g-portal.com/int/server/rust-console/${serverId}/console`;
    await page.goto(serverUrl, { waitUntil: "networkidle2" });

    const instanceKey = getInstanceKey(guildId, serverId);
    serverInstances.set(instanceKey, { browser, page });
    guildData.nicknames.set(nickname, serverId);
    guildData.ids.set(serverId, nickname);

    await logAllConsoleEntries({ browser, page }, nickname, guildId);
    saveServersToFile();

    await interaction.editReply(
      `Successfully connected to server: ${nickname}`
    );
  } catch (error) {
    console.error(`Failed to add server ${nickname}:`.red, error);
    await interaction.editReply("❌ Failed to add server. Please try again.");
  }
}

// Update the handleRunCommand function
async function handleRunCommand(interaction) {
  const guildId = interaction.guildId;
  const command = interaction.options.getString("command");
  const nickname = interaction.options.getString("server"); // Now optional
  const guildData = getGuildServers(guildId);

  await interaction.deferReply();

  try {
    const responses = new Map(); // Store responses from each server

    if (nickname) {
      // Run on specific server
      const serverId = guildData.nicknames.get(nickname);
      if (!serverId) {
        await interaction.editReply("❌ Server not found.");
        return;
      }

      const instanceKey = getInstanceKey(guildId, serverId);
      const instance = serverInstances.get(instanceKey);
      if (!instance) {
        await interaction.editReply("❌ Server not connected.");
        return;
      }

      const response = await executeCommand(instance, command, nickname);
      responses.set(nickname, response);
    } else {
      // Run on all servers
      for (const [nickname, serverId] of guildData.nicknames) {
        const instanceKey = getInstanceKey(guildId, serverId);
        const instance = serverInstances.get(instanceKey);
        if (instance) {
          const response = await executeCommand(instance, command, nickname);
          responses.set(nickname, response);
        }
      }

      if (responses.size === 0) {
        await interaction.editReply("❌ No servers are currently connected.");
        return;
      }
    }

    // Create embed with all responses
    const embed = new EmbedBuilder()
      .setTitle("Command Execution Results")
      .setColor(0x00ae86)
      .setDescription(`Command: \`${command}\``)
      .setTimestamp();

    for (const [server, response] of responses) {
      embed.addFields({
        name: `Server: ${server}`,
        value: response || "No response",
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error(`Error executing command:`.red, error);
    await interaction.editReply("❌ Failed to execute command.");
  }
}

// Update the ready event handler
client.once("ready", async () => {
  console.log("Bot is ready!".green);
  loadServersFromFile();
  bindSystem.loadBindsFromFile();
  updateExistingCategories();
  console.log("Initializing saved servers...".cyan);

  // Initialize servers for each guild
  for (const [guildId, guildData] of guildServers.entries()) {
    const initPromises = Array.from(guildData.nicknames.entries()).map(
      ([nickname, serverId]) => initializeServer(guildId, serverId, nickname)
    );

    await Promise.all(initPromises);
  }
  console.log("All servers initialized".green);
});

// Update initializeAutoTP function to properly initialize categories
function initializeAutoTP(guildId) {
  if (!guildAutoTP.has(guildId)) {
    guildAutoTP.set(guildId, {
      enabled: false,
      categories: {}, // Initialize empty categories object
      messages: {
        signup: "{PlayerName} signed up for {Category}!",
        exit: "{PlayerName} left {Category} AutoTP",
      },
    });
  }

  // Ensure categories exists
  const autotpData = guildAutoTP.get(guildId);
  if (!autotpData.categories) {
    autotpData.categories = {};
  }

  return autotpData;
}

// Function to get random coordinates
function getRandomCoordinates(autotpData) {
  if (!autotpData.coordinates || autotpData.coordinates.length === 0)
    return null;
  const randomIndex = Math.floor(Math.random() * autotpData.coordinates.length);
  return autotpData.coordinates[randomIndex].coords;
}

// Add this function near the top with other utility functions
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

// Update the handlePlayerRespawn function
async function handlePlayerRespawn(guildId, serverId, rawPlayerName) {
  const playerName = formatPlayerName(rawPlayerName);
  console.log(
    `Processing respawn - Player: ${playerName}, Guild: ${guildId}, Server: ${serverId}`
      .cyan
  );

  const autotpData = guildAutoTP.get(guildId);
  if (!autotpData?.enabled) {
    console.log(`AutoTP not enabled for guild ${guildId}`.yellow);
    return;
  }

  for (const [categoryName, category] of Object.entries(
    autotpData.categories
  )) {
    console.log(
      `Checking category ${categoryName} for player ${playerName}`.cyan
    );

    if (!category.activePlayers.includes(playerName)) {
      console.log(
        `Player ${playerName} not in category ${categoryName}`.yellow
      );
      continue;
    }

    if (!category.locations || category.locations.length === 0) {
      console.log(`No locations available in category ${categoryName}`.yellow);
      continue;
    }

    const cooldownKey = `${guildId}_${playerName}_${categoryName}`;
    const now = Date.now();
    const lastTP = lastTeleported.get(cooldownKey) || 0;

    if (now - lastTP < 5000) {
      console.log(
        `Cooldown active for ${playerName} in ${categoryName} (${Math.floor(
          (5000 - (now - lastTP)) / 1000
        )}s remaining)`.yellow
      );
      continue;
    }

    const randomLocation =
      category.locations[Math.floor(Math.random() * category.locations.length)];
    const instance = serverInstances.get(getInstanceKey(guildId, serverId));

    if (instance) {
      try {
        lastTeleported.set(cooldownKey, now);
        const tpCommand = `global.teleportpos ${randomLocation.coords} ${playerName}`;
        console.log(`Executing teleport command: ${tpCommand}`.cyan);
        await executeCommand(instance, tpCommand);
        console.log(
          `Auto-teleported ${playerName} to ${categoryName} location: ${randomLocation.coords}`
            .green
        );

        // Execute additional command if configured
        if (category.command) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay
          const formattedCommand = category.command.replace(
            "{PlayerName}",
            playerName
          );
          console.log(`Executing category command: ${formattedCommand}`.cyan);
          await executeCommand(instance, formattedCommand);
        }
      } catch (error) {
        console.error(`Failed to teleport ${playerName}:`.red, error);
      }
    }
  }
}

// Update the checkLogEntries function to properly detect respawns
async function checkLogEntries(logs, guildId, serverId) {
  const respawnRegex = /([^[\]]+?) \[(ps4|xboxone)\] has entered the game$/i;
  const chatPattern = /\[CHAT\s+([^\]]+)\]\s+([^:]+?)\s*:\s*(.+)/i;

  for (const log of logs) {
    console.log(`Processing log: ${log}`.gray);

    // Extract the actual message part after LOG:DEFAULT:
    if (log.includes(":LOG:DEFAULT:")) {
      const actualMessage = log.split(":LOG:DEFAULT:")[1].trim();
      console.log(`Checking message: ${actualMessage}`.gray);

      // Emit the consoleLog event for position handling
      client.emit("consoleLog", actualMessage);

      // Check for respawn events
      const respawnMatch = actualMessage.match(respawnRegex);
      if (respawnMatch) {
        const rawPlayerName = respawnMatch[1].trim();
        console.log(`Detected respawn for player: ${rawPlayerName}`.cyan);
        await handlePlayerRespawn(guildId, serverId, rawPlayerName);
        continue;
      }

      // Check for quick chat messages
      const chatMatch = actualMessage.match(chatPattern);
      if (chatMatch) {
        const [, chatType, rawPlayerName, message] = chatMatch;
        const playerName = formatPlayerName(rawPlayerName.trim());
        const instance = serverInstances.get(getInstanceKey(guildId, serverId));
        const nickname = guildServers.get(guildId).ids.get(serverId);

        if (instance) {
          // Process AutoTP
          const autotpData = initializeAutoTP(guildId);
          if (autotpData.enabled) {
            // Check each category's bind
            for (const [categoryName, category] of Object.entries(
              autotpData.categories
            )) {
              if (message.includes(category.bind)) {
                const playerIndex = category.activePlayers.indexOf(playerName);

                // First, remove player from any other categories
                for (const [otherCatName, otherCat] of Object.entries(
                  autotpData.categories
                )) {
                  if (otherCatName !== categoryName) {
                    const otherIndex =
                      otherCat.activePlayers.indexOf(playerName);
                    if (otherIndex !== -1) {
                      otherCat.activePlayers.splice(otherIndex, 1);
                      console.log(
                        `${playerName} removed from ${otherCatName} AutoTP`.cyan
                      );
                      if (autotpData.messages?.exit) {
                        await sendInGameMessage(
                          guildId,
                          serverId,
                          autotpData.messages.exit,
                          playerName,
                          otherCatName
                        );
                      }
                    }
                  }
                }

                if (playerIndex === -1) {
                  category.activePlayers.push(playerName);
                  console.log(
                    `${playerName} opted into ${categoryName} AutoTP`.cyan
                  );
                  saveServersToFile();

                  if (category.messages?.signup) {
                    await sendInGameMessage(
                      guildId,
                      serverId,
                      category.messages.signup,
                      playerName,
                      categoryName
                    );
                  }
                } else {
                  category.activePlayers.splice(playerIndex, 1);
                  console.log(
                    `${playerName} opted out of ${categoryName} AutoTP`.cyan
                  );
                  saveServersToFile();

                  if (category.messages?.exit) {
                    await sendInGameMessage(
                      guildId,
                      serverId,
                      category.messages.exit,
                      playerName,
                      categoryName
                    );
                  }
                }
                break;
              }
            }
          }

          // Process Binds
          try {
            // Check regular binds
            await bindSystem.checkBinds(
              actualMessage,
              guildId,
              serverId,
              async (cmd) => {
                console.log(`Executing bind command: ${cmd}`.yellow);
                return await executeCommand(instance, cmd, nickname);
              }
            );
          } catch (error) {
            console.error("Error processing binds:".red, error);
          }
        } else {
          // Check if this is a position response
          if (handleConsoleLog(actualMessage)) {
            continue; // Skip further processing if this was a position response
          }
        }
      }
    }
  }
}

// Update the message handling function for categories
async function sendInGameMessage(
  guildId,
  serverId,
  message,
  playerName,
  category = ""
) {
  if (!message) return;

  const instance = serverInstances.get(getInstanceKey(guildId, serverId));
  if (instance) {
    const formattedMessage = message
      .replace("{PlayerName}", playerName)
      .replace("{Category}", category);
    const sayCommand = `say ${formattedMessage}`;
    await executeCommand(instance, sayCommand);
  }
}

// Update handleCategoryCommand with better error handling
async function handleCategoryCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to manage categories.",
      ephemeral: true,
    });
    return;
  }

  try {
    const autotpData = initializeAutoTP(guildId);

    switch (subcommand) {
      case "add":
        const name = interaction.options.getString("name");
        const bind = interaction.options.getString("bind");
        const command = interaction.options.getString("command");

        if (!autotpData.categories) {
          autotpData.categories = {};
        }

        if (autotpData.categories[name]) {
          await interaction.reply(`❌ Category "${name}" already exists.`);
          return;
        }

        autotpData.categories[name] = {
          bind,
          locations: [],
          activePlayers: [],
          command: command || null,
          messages: {
            signup: null,
            exit: null,
          },
        };

        saveServersToFile();

        const addEmbed = new EmbedBuilder()
          .setTitle("Category Added")
          .setColor(0x00ae86)
          .addFields(
            { name: "Name", value: name, inline: true },
            { name: "Bind", value: bind, inline: true },
            { name: "Command", value: command || "None", inline: true }
          );

        await interaction.reply({ embeds: [addEmbed] });
        break;

      case "remove":
        const categoryName = interaction.options.getString("name");

        if (!autotpData.categories || !autotpData.categories[categoryName]) {
          await interaction.reply(`❌ Category "${categoryName}" not found.`);
          return;
        }

        delete autotpData.categories[categoryName];
        saveServersToFile();
        await interaction.reply(`✅ Removed category "${categoryName}"`);
        break;

      case "list":
        const listEmbed = new EmbedBuilder()
          .setTitle("AutoTP Categories")
          .setColor(0x00ae86)
          .setDescription(
            `Status: ${autotpData.enabled ? "✅ Enabled" : "❌ Disabled"}`
          );

        if (
          !autotpData.categories ||
          Object.keys(autotpData.categories).length === 0
        ) {
          listEmbed.addFields({
            name: "No Categories",
            value: "No categories have been created yet.",
          });
        } else {
          for (const [catName, category] of Object.entries(
            autotpData.categories
          )) {
            listEmbed.addFields({
              name: catName,
              value: `Bind: ${category.bind}\nLocations: ${
                category.locations?.length || 0
              }\nActive Players: ${
                category.activePlayers?.length || 0
              }\nCommand: ${category.command || "None"}`,
              inline: false,
            });
          }
        }

        await interaction.reply({ embeds: [listEmbed] });
        break;
    }
  } catch (error) {
    console.error("Error in category command:", error);
    await interaction.reply({
      content: "❌ An error occurred while managing categories.",
      ephemeral: true,
    });
  }
}

// Update handleAutoTPCommand for categories
async function handleAutoTPCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to manage Auto TP.",
      ephemeral: true,
    });
    return;
  }

  const autotpData = initializeAutoTP(guildId);

  switch (subcommand) {
    case "toggle":
      const enabled = interaction.options.getBoolean("enabled");
      autotpData.enabled = enabled;
      saveServersToFile();
      await interaction.reply(
        `✅ Auto TP has been ${enabled ? "enabled" : "disabled"}.`
      );
      break;

    case "add":
      const categoryName = interaction.options.getString("category");
      const name = interaction.options.getString("name");
      const coordinates = interaction.options.getString("coordinates");

      if (!autotpData.categories[categoryName]) {
        await interaction.reply(`❌ Category "${categoryName}" not found.`);
        return;
      }

      const formattedCoords = validateAndFormatCoords(coordinates);
      if (!formattedCoords) {
        await interaction.reply(
          "❌ Invalid coordinates format. Use: (x,y,z) or x,y,z"
        );
        return;
      }

      autotpData.categories[categoryName].locations.push({
        name,
        coords: formattedCoords,
      });
      saveServersToFile();
      await interaction.reply(
        `✅ Added location "${name}" to category "${categoryName}" with coordinates: (${formattedCoords})`
      );
      break;

    case "remove":
      const locationName = interaction.options.getString("name");
      let found = false;

      for (const category of Object.values(autotpData.categories)) {
        const index = category.locations.findIndex(
          (loc) => loc.name === locationName
        );
        if (index !== -1) {
          category.locations.splice(index, 1);
          found = true;
          break;
        }
      }

      if (found) {
        saveServersToFile();
        await interaction.reply(`✅ Removed location "${locationName}".`);
      } else {
        await interaction.reply(`❌ Location "${locationName}" not found.`);
      }
      break;

    case "list":
      const listEmbed = new EmbedBuilder()
        .setTitle("Auto TP Locations by Category")
        .setColor(0x00ae86)
        .setDescription(
          `Status: ${autotpData.enabled ? "✅ Enabled" : "❌ Disabled"}`
        );

      if (Object.keys(autotpData.categories).length === 0) {
        listEmbed.addFields({
          name: "No Categories",
          value: "No categories have been created yet.",
        });
      } else {
        for (const [catName, category] of Object.entries(
          autotpData.categories
        )) {
          let locationsList =
            category.locations.length === 0
              ? "No locations"
              : category.locations
                  .map((loc) => `${loc.name}: (${loc.coords})`)
                  .join("\n");

          listEmbed.addFields({
            name: `${catName} (Bind: ${category.bind})`,
            value: locationsList,
            inline: false,
          });
        }
      }

      await interaction.reply({ embeds: [listEmbed] });
      break;
  }
}

// Update handleTPMessageCommand for category-specific messages
async function handleTPMessageCommand(interaction) {
  const guildId = interaction.guildId;

  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content:
        "❌ You need administrator permissions to manage AutoTP messages.",
      ephemeral: true,
    });
    return;
  }

  const categoryName = interaction.options.getString("category");
  const signupMessage = interaction.options.getString("signup");
  const exitMessage = interaction.options.getString("exit");

  const autotpData = initializeAutoTP(guildId);

  if (!autotpData.categories?.[categoryName]) {
    await interaction.reply(`❌ Category "${categoryName}" not found.`);
    return;
  }

  // Initialize messages for category if they don't exist
  if (!autotpData.categories[categoryName].messages) {
    autotpData.categories[categoryName].messages = {
      signup: null,
      exit: null,
    };
  }

  if (signupMessage !== null) {
    autotpData.categories[categoryName].messages.signup = signupMessage;
  }
  if (exitMessage !== null) {
    autotpData.categories[categoryName].messages.exit = exitMessage;
  }

  saveServersToFile();

  const embed = new EmbedBuilder()
    .setTitle(`AutoTP Messages Updated for ${categoryName}`)
    .setColor(0x00ae86)
    .setDescription("Custom messages have been updated.")
    .addFields(
      {
        name: "Sign Up Message",
        value:
          autotpData.categories[categoryName].messages.signup || "*Not set*",
        inline: false,
      },
      {
        name: "Exit Message",
        value: autotpData.categories[categoryName].messages.exit || "*Not set*",
        inline: false,
      }
    );

  await interaction.reply({ embeds: [embed] });
}

// Add this function to handle server removal
async function handleRemoveServer(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to remove servers.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const guildId = interaction.guildId;
    const nickname = interaction.options.getString("server");
    const guildData = getGuildServers(guildId);

    // Check if server exists
    if (!guildData.nicknames.has(nickname)) {
      await interaction.editReply("❌ Server not found.");
      return;
    }

    const serverId = guildData.nicknames.get(nickname);
    const instanceKey = getInstanceKey(guildId, serverId);

    // Close browser instance if it exists
    const instance = serverInstances.get(instanceKey);
    if (instance) {
      try {
        clearInterval(instance.page._scrapeInterval);
        await instance.page.close();
        await instance.browser.close();
      } catch (error) {
        console.error(`Error closing browser for ${nickname}:`.red, error);
      }
      serverInstances.delete(instanceKey);
    }

    // Remove from maps
    guildData.nicknames.delete(nickname);
    guildData.ids.delete(serverId);
    guildData.colors.delete(nickname);

    // Save changes
    saveServersToFile();

    console.log(`Successfully removed server: ${nickname}`.green);
    await interaction.editReply(`Successfully removed server: ${nickname}`);
  } catch (error) {
    console.error(`Failed to remove server:`.red, error);
    await interaction.editReply(
      "❌ Failed to remove server. Please try again."
    );
  }
}

// Update the interaction handler to include the remove command
client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const guildId = interaction.guildId;
    const focusedOption = interaction.options.getFocused(true);
    const focusedValue = focusedOption.value.toLowerCase();

    // Add index autocomplete for bind remove command
    if (
      interaction.commandName === "bind" &&
      interaction.options.getSubcommand() === "remove"
    ) {
      if (focusedOption.name === "index") {
        // Get the selected server first
        const serverNickname = interaction.options.getString("server");
        if (!serverNickname) {
          await interaction.respond([]);
          return;
        }

        // Get the actual server ID
        const guildData = getGuildServers(guildId);
        const serverId = guildData.nicknames.get(serverNickname);
        if (!serverId) {
          await interaction.respond([]);
          return;
        }

        // Get binds for this server
        const binds = bindSystem.getBinds(guildId, serverId);

        let choices = [];
        if (binds?.length > 0) {
          choices = binds
            .map((bind, index) => ({
              name: `${index + 1}. ${bind.message} -> ${
                bind.type === "spawn" ? bind.entity : bind.command
              }`,
              value: index + 1,
            }))
            .filter(
              (choice) =>
                choice.name.toLowerCase().includes(focusedValue) ||
                choice.value.toString().includes(focusedValue)
            );
        }

        console.log(`Returning bind choices:`, choices); // Debug log
        await interaction.respond(choices.slice(0, 25));
        return;
      }
    }

    // Add category autocomplete for autotp add command
    if (
      interaction.commandName === "autotp" &&
      interaction.options.getSubcommand() === "add" &&
      interaction.options.getFocused(true).name === "category"
    ) {
      const autotpData = guildAutoTP.get(guildId) || { categories: {} };
      let choices = [];
      if (autotpData?.categories) {
        choices = Object.keys(autotpData.categories)
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add autocomplete for remove command
    if (
      interaction.commandName === "remove" &&
      interaction.options.getFocused(true).name === "server"
    ) {
      let choices = [];
      if (guildData?.nicknames) {
        choices = Array.from(guildData.nicknames.keys())
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add server autocomplete for run command
    if (
      interaction.commandName === "run" &&
      interaction.options.getFocused(true).name === "server"
    ) {
      let choices = [];
      if (guildData?.nicknames) {
        choices = Array.from(guildData.nicknames.keys())
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add category autocomplete for tpmessage command
    if (
      interaction.commandName === "tpmessage" &&
      interaction.options.getFocused(true).name === "category"
    ) {
      let choices = [];
      if (autotpData?.categories) {
        choices = Object.keys(autotpData.categories)
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add category autocomplete for gungame toggle command
    if (
      interaction.commandName === "gungame" &&
      interaction.options.getSubcommand() === "toggle" &&
      interaction.options.getFocused(true).name === "category"
    ) {
      const guildId = interaction.guildId;
      const autotpData = guildAutoTP.get(guildId);
      const focusedValue = interaction.options.getFocused().toLowerCase();

      let choices = [];
      if (autotpData?.categories) {
        choices = Object.keys(autotpData.categories)
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add this to your existing autocomplete handler
    if (
      interaction.commandName === "gungame" &&
      interaction.options.getSubcommand() === "remove" &&
      interaction.options.getFocused(true).name === "index"
    ) {
      const guildId = interaction.guildId;
      const gunGameData = guildGunGame.get(guildId);
      const focusedValue = interaction.options.getFocused().toLowerCase();

      let choices = [];
      if (Array.isArray(gunGameData?.weapons)) {
        choices = gunGameData.weapons.map((weapon, index) => ({
          name: `${index + 1}. ${weapon.weapon} (${weapon.kills} kills)`,
          value: index + 1,
        }));

        // Filter based on input if user is typing a number
        if (focusedValue) {
          choices = choices.filter(
            (choice) =>
              choice.name.toLowerCase().includes(focusedValue) ||
              choice.value.toString().includes(focusedValue)
          );
        }
      }

      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add server autocomplete for bind commands
    if (
      interaction.commandName === "bind" &&
      (interaction.options.getSubcommand() === "add" ||
        interaction.options.getSubcommand() === "remove" ||
        interaction.options.getSubcommand() === "list") &&
      interaction.options.getFocused(true).name === "server"
    ) {
      const guildId = interaction.guildId;
      const guildData = getGuildServers(guildId);
      const focusedValue = interaction.options.getFocused().toLowerCase();

      let choices = [];
      if (guildData?.nicknames) {
        choices = Array.from(guildData.nicknames.keys())
          .map((name) => ({ name, value: name }))
          .filter((choice) => choice.name.toLowerCase().includes(focusedValue));
      }
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    // Add resetcooldown command
    if (interaction.commandName === "resetcooldown") {
      await handleResetCooldown(interaction);
      return;
    }
  }

  if (!interaction.isCommand()) return;

  switch (interaction.commandName) {
    case "add":
      await handleAddServer(interaction);
      break;
    case "remove":
      await handleRemoveServer(interaction);
      break;
    case "run":
      await handleRunCommand(interaction);
      break;
    case "autotp":
      await handleAutoTPCommand(interaction);
      break;
    case "tpmessage":
      await handleTPMessageCommand(interaction);
      break;
    case "category":
      await handleCategoryCommand(interaction);
      break;
    case "gungame":
      await handleGunGameCommand(interaction);
      break;
    case "link":
      await handleLinkCommand(interaction);
      break;
    case "unlink":
      await handleUnlinkCommand(interaction);
      break;
    case "linkrole":
      await handleLinkRoleCommand(interaction);
      break;
    case "bind":
      switch (interaction.options.getSubcommand()) {
        case "add":
          await bindSystem.handleBindAdd(interaction);
          break;
        case "remove":
          await bindSystem.handleBindRemove(interaction);
          break;
        case "list":
          await bindSystem.handleBindList(interaction);
          break;
      }
      break;
    case "resetcooldown":
      await handleResetCooldown(interaction);
      break;
  }
});

// Update the message command handler for !console
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!console")) return;

  // Check if the user has administrator permissions
  if (!isAdmin(message.member)) {
    await message.reply(
      "❌ You need administrator permissions to use console commands."
    );
    return;
  }

  const args = message.content.slice(8).trim().split(/ +/);
  const nickname = args.shift();
  const command = args.join(" ");

  // Get guild data and server ID
  const guildId = message.guildId;
  const guildData = getGuildServers(guildId);

  // Get the real server ID from the nickname
  const serverId = guildData.nicknames.get(nickname);
  if (!serverId) {
    await message.reply("❌ Server not found.");
    return;
  }

  const instanceKey = getInstanceKey(guildId, serverId);
  const instance = serverInstances.get(instanceKey);
  if (!instance) {
    await message.reply("❌ Server not connected.");
    return;
  }

  try {
    const response = await executeCommand(instance, command, nickname);
    await message.reply(
      `Command executed on ${nickname}:\n\`${command}\`\nResponse: ${response}`
    );
  } catch (error) {
    console.error("Error executing command:", error);
    await message.reply("❌ Failed to execute command.");
  }
});

// Handle shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const [serverId, instance] of serverInstances) {
    try {
      await instance.browser.close();
    } catch (error) {
      console.error(`Error closing browser for server ${serverId}:`, error);
    }
  }
  process.exit();
});

// Update the login section at the bottom of the file
async function loginWithRetry(retryCount = 0) {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error(`Login attempt ${retryCount + 1} failed:`.red, error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`.yellow);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      await loginWithRetry(retryCount + 1);
    } else {
      console.error(
        `Failed to connect after ${MAX_RETRIES} attempts. Please check your internet connection.`
          .red
      );
      process.exit(1);
    }
  }
}

// Add error handlers
client.on("error", (error) => {
  console.error("Discord client error:".red, error);
});

client.on("disconnect", () => {
  console.log(
    "Bot disconnected from Discord. Attempting to reconnect...".yellow
  );
});

client.on("reconnecting", () => {
  console.log("Bot is reconnecting to Discord...".yellow);
});

// Replace client.login with our new login function
loginWithRetry().catch((error) => {
  console.error("Fatal error during login:".red, error);
  process.exit(1);
});

// Add this function near the top with other utility functions
function validateAndFormatCoords(coordString) {
  // Match coordinates in format (x,y,z) or x,y,z with optional decimals
  const coordRegex = /^\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?$/;
  const match = coordString.match(coordRegex);

  if (!match) return null;

  // Return formatted coordinates with exact decimal places
  return `${match[1]},${match[2]},${match[3]}`;
}

// Update initializeGunGame function to store category-specific settings
function initializeGunGame(guildId) {
  if (!guildGunGame.has(guildId)) {
    guildGunGame.set(guildId, {
      categories: {}, // Store category-specific settings
      weapons: [],
      playerProgress: new Map(), // playerName -> {currentWeaponIndex, kills}
    });
  }
  return guildGunGame.get(guildId);
}

// Update handleKillEvent to use proper player name formatting
async function handleKillEvent(
  guildId,
  serverId,
  rawKillerName,
  rawVictimName
) {
  const killerName = formatPlayerName(rawKillerName);
  const victimName = formatPlayerName(rawVictimName);

  console.log(`Processing kill event for guild ${guildId}`.cyan);
  console.log(`- Formatted Killer: ${killerName}`.cyan);
  console.log(`- Formatted Victim: ${victimName}`.cyan);

  const gunGameData = guildGunGame.get(guildId);
  const autotpData = guildAutoTP.get(guildId);

  if (!gunGameData || !gunGameData.categories) {
    console.log("GunGame not initialized".yellow);
    return;
  }

  // Check which category the killer is in (if any)
  let activeCategory = null;
  for (const [categoryName, category] of Object.entries(
    autotpData?.categories || {}
  )) {
    // Use exact match with formatted names
    if (
      category.activePlayers.includes(killerName) &&
      gunGameData.categories[categoryName]?.enabled
    ) {
      activeCategory = categoryName;
      break;
    }
  }

  if (!activeCategory) {
    console.log(`${killerName} not in any active GunGame category`.yellow);
    return;
  }

  console.log(
    `Player ${killerName} is in active GunGame category: ${activeCategory}`.cyan
  );

  // Initialize player progress if needed
  if (!gunGameData.playerProgress.has(killerName)) {
    console.log(`Initializing progress for ${killerName}`.cyan);
    gunGameData.playerProgress.set(killerName, {
      currentWeaponIndex: 0,
      kills: 0,
    });
  }

  const playerProgress = gunGameData.playerProgress.get(killerName);
  const currentWeapon = gunGameData.weapons[playerProgress.currentWeaponIndex];

  console.log(
    `Player Progress - Index: ${playerProgress.currentWeaponIndex}, Kills: ${playerProgress.kills}`
      .cyan
  );
  console.log(`Current Weapon: ${JSON.stringify(currentWeapon)}`.cyan);

  if (!currentWeapon) {
    console.log("No current weapon found".yellow);
    return;
  }

  const instance = serverInstances.get(getInstanceKey(guildId, serverId));
  if (!instance) return;

  // Increment kills first
  playerProgress.kills++;
  console.log(
    `Updated kills: ${playerProgress.kills}/${currentWeapon.kills}`.cyan
  );

  // Check if player has enough kills to advance
  if (playerProgress.kills >= currentWeapon.kills) {
    playerProgress.currentWeaponIndex++;
    playerProgress.kills = 0;
    console.log(
      `Player advanced to index ${playerProgress.currentWeaponIndex}`.green
    );

    // Check if player has won
    if (playerProgress.currentWeaponIndex >= gunGameData.weapons.length) {
      console.log(`${killerName} has won the game!`.green);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Announce winner and game reset
      await executeCommand(
        instance,
        `say "${killerName} has won Gun Game in ${activeCategory}! Game has been reset."`
      );

      // Reset ALL players' progress
      gunGameData.playerProgress.clear();

      // Optional: Give winner a special message
      await new Promise((resolve) => setTimeout(resolve, 500));
      await executeCommand(
        instance,
        `say "Congratulations ${killerName}! A new game will begin with the next kill."`
      );

      saveServersToFile();
      return;
    }

    // Only give next weapon if player hasn't won
    if (playerProgress.currentWeaponIndex < gunGameData.weapons.length) {
      // Give player their next weapon
      const nextWeapon = gunGameData.weapons[playerProgress.currentWeaponIndex];
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(
        `Giving ${killerName} next weapon: ${nextWeapon.weapon}`.cyan
      );
      await executeCommand(
        instance,
        `inventory.giveto ${killerName} "${nextWeapon.weapon}"`
      );

      // Give ammo for next weapon if specified
      if (nextWeapon.ammo) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const [ammoType, ammoAmount] = nextWeapon.ammo.split(" ");
        console.log(
          `Giving ${killerName} ammo: ${ammoType} x${ammoAmount}`.cyan
        );
        await executeCommand(
          instance,
          `inventory.giveto ${killerName} "${ammoType}" "${ammoAmount}"`
        );
      }

      // Send advancement message
      await new Promise((resolve) => setTimeout(resolve, 500));
      const advancementMessage = `${killerName} advanced to ${
        nextWeapon.weapon
      }! (${playerProgress.currentWeaponIndex + 1}/${
        gunGameData.weapons.length
      })`;
      await executeCommand(instance, `say "${advancementMessage}"`);
    }
  }

  saveServersToFile();
}

// Update handleGunGameCommand to handle category-specific toggles
async function handleGunGameCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to manage Gun Game.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const gunGameData = initializeGunGame(guildId);

  // Ensure categories exists
  if (!gunGameData.categories) {
    gunGameData.categories = {};
  }

  switch (subcommand) {
    case "toggle":
      const categoryName = interaction.options.getString("category");
      const enabled = interaction.options.getBoolean("enabled");

      // Verify category exists in AutoTP
      const autotpData = guildAutoTP.get(guildId);
      if (!autotpData?.categories?.[categoryName]) {
        await interaction.reply(
          `❌ Category "${categoryName}" not found in AutoTP categories.`
        );
        return;
      }

      // Initialize category if needed
      if (!gunGameData.categories[categoryName]) {
        gunGameData.categories[categoryName] = { enabled: false };
      }

      gunGameData.categories[categoryName].enabled = enabled;
      if (enabled) {
        // Only reset progress for players in this category
        for (const [
          playerName,
          progress,
        ] of gunGameData.playerProgress.entries()) {
          if (
            autotpData.categories[categoryName].activePlayers.includes(
              playerName
            )
          ) {
            gunGameData.playerProgress.delete(playerName);
          }
        }
      }

      saveServersToFile();
      await interaction.reply(
        `✅ Gun Game has been ${
          enabled ? "enabled" : "disabled"
        } for category "${categoryName}".`
      );
      break;

    case "weapon":
      const weapon = interaction.options.getString("name");
      const kills = interaction.options.getInteger("kills");
      const ammo = interaction.options.getString("ammo");

      if (!Array.isArray(gunGameData.weapons)) {
        gunGameData.weapons = [];
      }

      gunGameData.weapons.push({
        weapon,
        kills,
        ammo: ammo || null,
      });
      saveServersToFile();

      const embed = new EmbedBuilder()
        .setTitle("Gun Game Weapon Added")
        .setColor(0x00ae86)
        .addFields(
          { name: "Weapon", value: weapon, inline: true },
          { name: "Required Kills", value: kills.toString(), inline: true },
          { name: "Ammo", value: ammo || "None", inline: true }
        );

      await interaction.reply({ embeds: [embed] });
      break;

    case "remove":
      const weaponIndex = interaction.options.getInteger("index") - 1; // Convert to 0-based index

      if (
        !Array.isArray(gunGameData.weapons) ||
        weaponIndex < 0 ||
        weaponIndex >= gunGameData.weapons.length
      ) {
        await interaction.reply(
          "❌ Invalid weapon index. Use /gungame list to see weapon indices."
        );
        return;
      }

      const removedWeapon = gunGameData.weapons.splice(weaponIndex, 1)[0];

      // Reset progress for players if they were using this or a later weapon
      for (const [
        playerName,
        progress,
      ] of gunGameData.playerProgress.entries()) {
        if (progress.currentWeaponIndex >= weaponIndex) {
          gunGameData.playerProgress.delete(playerName);
        }
      }

      saveServersToFile();

      const removeEmbed = new EmbedBuilder()
        .setTitle("Gun Game Weapon Removed")
        .setColor(0x00ae86)
        .setDescription(
          `Removed weapon: ${removedWeapon.weapon} (${removedWeapon.kills} kills)`
        )
        .addFields({
          name: "Note",
          value:
            "Players using this or later weapons have had their progress reset.",
        });

      await interaction.reply({ embeds: [removeEmbed] });
      break;

    case "list":
      const listEmbed = new EmbedBuilder()
        .setTitle("Gun Game Status")
        .setColor(0x00ae86);

      // Add category statuses
      const categoryFields = [];
      if (
        gunGameData.categories &&
        Object.keys(gunGameData.categories).length > 0
      ) {
        for (const [catName, catData] of Object.entries(
          gunGameData.categories
        )) {
          categoryFields.push({
            name: catName,
            value: catData.enabled ? "✅ Enabled" : "❌ Disabled",
            inline: true,
          });
        }
      }

      if (categoryFields.length > 0) {
        listEmbed.addFields(categoryFields);
      } else {
        listEmbed.addFields({
          name: "Categories",
          value: "No categories configured",
        });
      }

      // Add weapons list
      if (
        Array.isArray(gunGameData.weapons) &&
        gunGameData.weapons.length > 0
      ) {
        listEmbed.addFields({
          name: "Weapons",
          value: gunGameData.weapons
            .map(
              (w, i) =>
                `${i + 1}. ${w.weapon} (${w.kills} kills)${
                  w.ammo ? ` + ${w.ammo}` : ""
                }`
            )
            .join("\n"),
        });
      } else {
        listEmbed.addFields({
          name: "Weapons",
          value: "No weapons configured",
        });
      }

      await interaction.reply({ embeds: [listEmbed] });
      break;

    case "reset":
      gunGameData.weapons = [];
      gunGameData.categories = {};
      gunGameData.playerProgress.clear();
      saveServersToFile();
      await interaction.reply("✅ Gun Game has been completely reset.");
      break;
  }
}

// Update linkPlayer to be async
async function linkPlayer(discordId, guildId, gamertag, console) {
  // Check if player is already linked
  for (const [existingId, data] of playerLinks.entries()) {
    if (data.gamertag.toLowerCase() === gamertag.toLowerCase()) {
      return {
        success: false,
        message: "This gamertag is already linked to another Discord user.",
      };
    }
    if (existingId === discordId) {
      return {
        success: false,
        message: "Your Discord account is already linked to a gamertag.",
      };
    }
  }

  playerLinks.set(discordId, {
    gamertag,
    console,
    guildId,
  });

  // Add the link role if one is set
  const roleId = guildLinkRoles.get(guildId);
  if (roleId) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(discordId);
        if (member) {
          await member.roles.add(roleId);
        }
      }
    } catch (error) {
      console.error(`Failed to add link role to user ${discordId}:`.red, error);
    }
  }

  saveServersToFile();
  return {
    success: true,
    message: `Successfully linked ${gamertag} (${console}) to your Discord account.`,
  };
}

// Update unlinkPlayer to be async
async function unlinkPlayer(discordId) {
  if (!playerLinks.has(discordId)) {
    return {
      success: false,
      message: "This Discord user is not linked to any gamertag.",
    };
  }

  const data = playerLinks.get(discordId);
  const roleId = guildLinkRoles.get(data.guildId);

  // Remove the link role if one is set
  if (roleId) {
    try {
      const guild = client.guilds.cache.get(data.guildId);
      if (guild) {
        const member = await guild.members.fetch(discordId);
        if (member) {
          await member.roles.remove(roleId);
        }
      }
    } catch (error) {
      console.error(
        `Failed to remove link role from user ${discordId}:`.red,
        error
      );
    }
  }

  playerLinks.delete(discordId);
  saveServersToFile();
  return {
    success: true,
    message: `Successfully unlinked ${data.gamertag} from Discord account.`,
  };
}

// Update handleLinkCommand to handle async linkPlayer
async function handleLinkCommand(interaction) {
  const discordId = interaction.user.id;
  const guildId = interaction.guildId;
  const gamertag = interaction.options.getString("gamertag");
  const console = interaction.options.getString("console");

  const result = await linkPlayer(discordId, guildId, gamertag, console);

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle("Account Linked")
      .setColor(0x00ae86)
      .addFields(
        { name: "Discord", value: `<@${discordId}>`, inline: true },
        { name: "Gamertag", value: gamertag, inline: true },
        { name: "Console", value: console, inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `❌ ${result.message}`,
      ephemeral: true,
    });
  }
}

// Update handleUnlinkCommand to handle async unlinkPlayer
async function handleUnlinkCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to unlink accounts.",
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("user");
  const result = await unlinkPlayer(targetUser.id);

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle("Account Unlinked")
      .setColor(0x00ae86)
      .setDescription(result.message)
      .addFields({
        name: "Discord User",
        value: `<@${targetUser.id}>`,
        inline: true,
      });

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `❌ ${result.message}`,
      ephemeral: true,
    });
  }
}

// Add handler for linkrole command
async function handleLinkRoleCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to set the link role.",
      ephemeral: true,
    });
    return;
  }

  const role = interaction.options.getRole("role");
  const guildId = interaction.guildId;

  // Save the role ID
  guildLinkRoles.set(guildId, role.id);
  saveServersToFile();

  // Update all currently linked players with the new role
  const guild = interaction.guild;
  for (const [discordId, linkData] of playerLinks.entries()) {
    if (linkData.guildId === guildId) {
      try {
        const member = await guild.members.fetch(discordId);
        if (member) {
          await member.roles.add(role);
        }
      } catch (error) {
        console.error(`Failed to add role to user ${discordId}:`.red, error);
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("Link Role Updated")
    .setColor(0x00ae86)
    .setDescription(`Successfully set ${role} as the linked players role.`)
    .addFields(
      { name: "Role", value: role.name, inline: true },
      { name: "Role ID", value: role.id, inline: true }
    );

  await interaction.reply({ embeds: [embed] });
}

// After requiring bindSystem
bindSystem.initialize(getGuildServers, client, playerLinks);

// Update the handleConsoleLog function
function handleConsoleLog(log) {
  console.log(`Processing console log: ${log}`.gray);
  return bindSystem.handleConsoleLog(log);
}

// Add this function to handle the reset cooldown command
async function handleResetCooldown(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "❌ You need administrator permissions to reset cooldowns.",
      ephemeral: true,
    });
    return;
  }

  const serverNickname = interaction.options.getString("server");
  const playerName = interaction.options.getString("player");
  const bindMessage = interaction.options.getString("bind");
  const guildId = interaction.guildId;

  // Get the actual server ID from the nickname
  const guildData = getGuildServers(guildId);
  const serverId = guildData.nicknames.get(serverNickname);

  if (!serverId) {
    await interaction.reply("❌ Invalid server selected.");
    return;
  }

  // Format player name consistently
  const formattedPlayerName = formatPlayerName(playerName);

  try {
    let resetCount = 0;
    const binds = bindSystem.getBinds(guildId, serverId);

    if (!binds || binds.length === 0) {
      await interaction.reply("❌ No binds found for this server.");
      return;
    }

    // If a specific bind was specified, only reset that one
    if (bindMessage) {
      const bind = binds.find((b) => b.message === bindMessage);
      if (bind) {
        const cooldownKey = `${guildId}_${serverId}_${formattedPlayerName}_${bind.message}`;
        bindSystem.resetCooldown(cooldownKey);
        resetCount = 1;
      }
    } else {
      // Reset all bind cooldowns for the player
      for (const bind of binds) {
        const cooldownKey = `${guildId}_${serverId}_${formattedPlayerName}_${bind.message}`;
        bindSystem.resetCooldown(cooldownKey);
        resetCount++;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("Cooldown Reset")
      .setColor(0x00ae86)
      .setDescription(
        `Reset ${resetCount} cooldown${
          resetCount !== 1 ? "s" : ""
        } for ${formattedPlayerName}`
      )
      .addFields(
        { name: "Server", value: serverNickname, inline: true },
        { name: "Player", value: formattedPlayerName, inline: true },
        { name: "Bind", value: bindMessage || "All binds", inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error resetting cooldown:", error);
    await interaction.reply({
      content: "❌ An error occurred while resetting the cooldown.",
      ephemeral: true,
    });
  }
}

// Update this function with the correct command format
function updateExistingCategories() {
    // Get all guilds
    for (const [guildId, guildData] of guildAutoTP.entries()) {
        // Check if the guild has the Free For All category
        if (guildData?.categories?.["Free For All"]) {
            console.log(`Updating Free For All category for guild ${guildId}`.cyan);
            guildData.categories["Free For All"].command = 'kit givetoplayer pvp "{PlayerName}"';
        }
    }
    saveServersToFile();
}
