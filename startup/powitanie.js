const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ID kanałów
const WELCOME_CHANNEL_ID = '1452583080333410455';
const RULES_CHANNEL_ID = '1452645730102677555';
const CONTEST_CHANNEL_ID = '1321027576277499944';
const INVITE_CHANNEL_ID = '1452973749543374911'; // kanał z przyciskiem generowania linku
const LOG_CHANNEL_ID = '1313177666878443540'; // kanał logów
const GUIDE_CHANNEL_ID = '1452939178571595886'; // kanał z regulaminem/guide

// ID emoji
const EMOJI_IDS = {
    welcome: '1452715257586913373',
    rules: '1452715580456042647',
    contest: '1452715878205624391',
    inviter: '1452951976785481741'
};

// Plik do zapisywania stanu
const DATA_FILE = path.join(__dirname, 'invite_data.json');

// Funkcja do odczytu danych
function readData() {
    if (!fs.existsSync(DATA_FILE)) return { embedSent: false, users: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

// Funkcja do zapisu danych
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

module.exports = (client) => {

    /*** Wczytaj dane przy starcie ***/
    const data = readData();

    /*** 1️⃣ Powitanie nowych użytkowników ***/
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
            const memberCount = member.guild.memberCount;

            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)?.toString() || '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)?.toString() || '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)?.toString() || '🏆';

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `\`\`\`👋 Sprawdziany & Kartkówki × WITAMY NA SERWERZE!\`\`\`\n` +
                    `> ${emojiWelcome} **Witaj** <@${member.id}> na serwerze **Sprawdziany & Kartkówki!**\n` +
                    `> ${emojiRules} Zapoznaj się z naszym **regulaminem**: <#${RULES_CHANNEL_ID}>\n` +
                    `> ${emojiContest} Musisz koniecznie sprawdzić **Konkursy!** <#${CONTEST_CHANNEL_ID}>`
                )
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`,
                    iconURL: 'https://cdn.discordapp.com/attachments/1313035660709593160/1452946476513759302/file_00000000671c71f4ba93b970114f47d5.png'
                });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('member_count_info')
                    .setLabel(`👤 Jesteś naszym ${memberCount} użytkownikiem`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await channel.send({
                content: `||<@${member.id}>||`,
                embeds: [embed],
                components: [row]
            });

        } catch (err) {
            console.error('Błąd w powitanie.js:', err);
        }
    });

    /*** 2️⃣ Embed z przyciskiem do generowania linku (tylko raz) ***/
    client.once(Events.ClientReady, async () => { // używamy 'once', aby upewnić się, że event odpalony tylko raz
        try {
            const channel = client.channels.cache.get(INVITE_CHANNEL_ID);
            if (!channel) return console.error('Nie znaleziono kanału INVITE_CHANNEL_ID');

            if (!data.embedSent) {
                const embed = new EmbedBuilder()
                    .setTitle('🔗 Link z zaproszeniem')
                    .setDescription(`Kliknij przycisk poniżej, aby wygenerować link zaproszenia na serwer!\n\nZachęcamy do zapoznania się z kanałem: <#${GUIDE_CHANNEL_ID}>`)
                    .setColor('Blue');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('generate_invite')
                        .setLabel('Generuj link zaproszenia')
                        .setStyle(ButtonStyle.Primary)
                );

                await channel.send({ embeds: [embed], components: [row] });

                data.embedSent = true;
                saveData(data);
                console.log('Embed z przyciskiem wysłany na INVITE_CHANNEL_ID ✅');
            } else {
                console.log('Embed z przyciskiem został już wysłany wcześniej ✅');
            }
        } catch (err) {
            console.error('Błąd podczas wysyłania embedu z przyciskiem:', err);
        }
    });

    /*** 3️⃣ Obsługa przycisku generowania linku i logowanie ***/
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'generate_invite') return;

        try {
            const member = interaction.member;

            // Tworzymy unikalny link zaproszenia
            const invite = await interaction.guild.invites.create(interaction.channel, {
                maxAge: 0,
                maxUses: 0,
                unique: true
            });

            // Wysyłamy użytkownikowi w DM
            await member.send(`Twój link zaproszenia: ${invite.url}`);

            // Potwierdzenie dla użytkownika
            await interaction.reply({ content: 'Link został wygenerowany i wysłany w DM ✅', ephemeral: true });

            // Zaktualizuj dane w pliku JSON
            if (!data.users[member.id]) {
                data.users[member.id] = { generatedLinks: [], invitedMembers: 0, joinedMembers: 0 };
            }
            data.users[member.id].generatedLinks.push({ link: invite.url, timestamp: Date.now() });
            saveData(data);

            // Logi w kanale LOG_CHANNEL_ID
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const logEmbed = new EmbedBuilder()
                .setTitle('📝 Nowy link zaproszenia wygenerowany')
                .addFields(
                    { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
                    { name: 'Link', value: invite.url, inline: true },
                    { name: 'Kanał', value: `<#${interaction.channel.id}>`, inline: true },
                    { name: 'Godzina', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                    { name: 'Ilość wygenerowanych linków przez użytkownika', value: `${data.users[member.id].generatedLinks.length}`, inline: true },
                    { name: 'Całkowita liczba wygenerowanych linków na serwerze', value: `${Object.values(data.users).reduce((a,b)=>a+b.generatedLinks.length,0)}`, inline: true }
                )
                .setColor('Green');

            await logChannel.send({ embeds: [logEmbed] });

        } catch (err) {
            console.error('Błąd przy generowaniu linku:', err);
            await interaction.reply({ content: 'Wystąpił błąd ❌', ephemeral: true });
        }
    });
};
