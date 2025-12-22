const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');

// Tworzenie klienta Discord
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Kolekcja komend
client.commands = new Collection();

// ==============================
// 1️⃣ Ładowanie standardowych komend z folderu commands
// ==============================
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
        }
    }
}

// ==============================
// 2️⃣ Ładowanie „jednorazowych” skryptów startup z folderu startup
// ==============================
const startupPath = path.join(__dirname, 'startup');
if (fs.existsSync(startupPath)) {
    const startupFiles = fs.readdirSync(startupPath).filter(file => file.endsWith('.js'));
    for (const file of startupFiles) {
        require(path.join(startupPath, file))(client);
    }
}

// Event: bot gotowy
client.once('ready', async () => {
    console.log(`Bot zalogowany jako ${client.user.tag}`);

    // Rejestracja slash commandów u Discorda
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Rejestracja slash commandów...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash commandy zarejestrowane!');
    } catch (error) {
        console.error(error);
    }
});

// Obsługa wywołań slash commandów
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Wystąpił błąd przy wykonywaniu tej komendy.', ephemeral: true });
    }
});

// Prosty serwer HTTP, żeby Render wykrył, że aplikacja działa
http.createServer((req, res) => {
    res.end('Bot działa i jest online!');
}).listen(process.env.PORT, () => {
    console.log(`Serwer HTTP działa na porcie ${process.env.PORT}`);
});

// Logowanie bota
client.login(process.env.DISCORD_TOKEN);
