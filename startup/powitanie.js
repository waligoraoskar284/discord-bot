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

// ID emoji z serwera
const EMOJI_IDS = {
    welcome: '1452715257586913373',
    rules: '1452715580456042647',
    contest: '1452715878205624391',
    inviter: '1452951976785481741'
};

// Cache wszystkich zaproszeń (guildId -> Map<code, inviterId>)
const invitesCache = new Map();

module.exports = (client) => {

    // 1️⃣ Śledzenie wszystkich zaproszeń przy starcie bota
    client.on(Events.ClientReady, async () => {
        client.guilds.cache.forEach(async guild => {
            const invites = await guild.invites.fetch();
            // Mapujemy kod zaproszenia -> inviter.id
            const codeMap = new Map();
            invites.forEach(inv => codeMap.set(inv.code, inv.inviter.id));
            invitesCache.set(guild.id, codeMap);
        });
        console.log('Cache zaproszeń został załadowany!');
    });

    // 2️⃣ Aktualizacja cache przy każdym nowym zaproszeniu
    client.on(Events.InviteCreate, invite => {
        const guildMap = invitesCache.get(invite.guild.id) || new Map();
        guildMap.set(invite.code, invite.inviter.id);
        invitesCache.set(invite.guild.id, guildMap);
    });

    // 3️⃣ Usuwanie zaproszenia z cache jeśli zostanie usunięte
    client.on(Events.InviteDelete, invite => {
        const guildMap = invitesCache.get(invite.guild.id);
        if (guildMap) {
            guildMap.delete(invite.code);
        }
    });

    // 4️⃣ Powitanie nowego członka
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
            const memberCount = member.guild.memberCount;

            // Pobranie emoji z serwera
            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)?.toString() || '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)?.toString() || '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)?.toString() || '🏆';
            const emojiInviter = guildEmojis.get(EMOJI_IDS.inviter)?.toString() || '🔗';

            // Pobranie użytego zaproszenia
            const guildMap = invitesCache.get(member.guild.id) || new Map();
            let inviterText = `Zaprosiciel nieznany`;

            // Porównanie użyć zaproszeń
            const newInvites = await member.guild.invites.fetch();
            for (const invite of newInvites.values()) {
                const previousUses = invite.uses - 1; // poprzednie użycia
                const cachedInviter = guildMap.get(invite.code);
                if (invite.uses > previousUses && cachedInviter) {
                    inviterText = `<@${cachedInviter}>`;
                    break;
                }
            }

            // Aktualizacja cache
            const updatedMap = new Map();
            newInvites.forEach(inv => updatedMap.set(inv.code, inv.inviter.id));
            invitesCache.set(member.guild.id, updatedMap);

            // Tworzymy embed
            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `\`\`\`👋 Sprawdziany & Kartkówki × WITAMY NA SERWERZE!\`\`\`\n` +
                    `> ${emojiWelcome} **Witaj** <@${member.id}> na serwerze **Sprawdziany & Kartkówki!**\n` +
                    `> ${emojiRules} Zapoznaj się z naszym **regulaminem**: <#${RULES_CHANNEL_ID}>\n` +
                    `> ${emojiContest} Musisz koniecznie sprawdzić **Konkursy!** <#${CONTEST_CHANNEL_ID}>\n` +
                    `> ${emojiInviter} Zaproszony przez: ${inviterText}`
                )
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`,
                    iconURL: 'https://cdn.discordapp.com/attachments/1313035660709593160/1452946476513759302/file_00000000671c71f4ba93b970114f47d5.png'
                });

            // Tworzymy nieklikalny przycisk z liczbą członków
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
};
