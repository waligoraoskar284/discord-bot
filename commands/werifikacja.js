require('dotenv').config(); // Do ładowania zmiennych środowiskowych

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ID kanałów i roli
const verificationChannelId = '1313035660709593160';
const logChannelId = '1452604416216793119';
const roleId = '1312763974718193735';

client.once(Events.ClientReady, async () => {
    console.log(`Zalogowano jako ${client.user.tag}`);

    try {
        const verificationChannel = await client.channels.fetch(verificationChannelId);
        if (!verificationChannel) return console.log('Nie znaleziono kanału weryfikacji!');

        // Utworzenie przycisku
        const button = new ButtonBuilder()
            .setCustomId('verify_button')
            .setLabel('Zweryfikuj się')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        // Wysłanie wiadomości z przyciskiem
        await verificationChannel.send({
            content: 'Kliknij przycisk aby zweryfikować swoje konto!',
            components: [row],
        });
    } catch (error) {
        console.error('Błąd przy wysyłaniu wiadomości weryfikacyjnej:', error);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify_button') {
        const member = interaction.member;

        if (!member.roles.cache.has(roleId)) {
            try {
                await member.roles.add(roleId);
                await interaction.reply({ content: '✅ Zostałeś zweryfikowany!', ephemeral: true });

                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) {
                    logChannel.send(`✅ Użytkownik ${member.user.tag} został zweryfikowany.`);
                }
            } catch (error) {
                console.error('Błąd przy weryfikacji użytkownika:', error);
                await interaction.reply({ content: '❌ Wystąpił błąd przy weryfikacji.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: '❌ Jesteś już zweryfikowany!', ephemeral: true });
        }
    }
});

// Logowanie bota przy użyciu zmiennej środowiskowej
client.login(process.env.BOT_TOKEN);
