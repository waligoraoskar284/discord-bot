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

// ID emoji
const EMOJI_WELCOME = '<:emoji1:1452715257586913373>';
const EMOJI_RULES = '<:emoji2:1452715580456042647>';
const EMOJI_CONTEST = '<:emoji3:1452715878205624391>';

module.exports = (client) => {
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;

            const memberCount = member.guild.memberCount;

            const embed = new EmbedBuilder()
                .setColor('#00FF7F')
                .setAuthor({
                    name: member.user.tag,
                    iconURL: member.user.displayAvatarURL()
                })
                .setDescription(
                    `${EMOJI_WELCOME} Witaj <@${member.id}> na serwerze Sprawdziany & Kartkówki!\n\n` +
                    `${EMOJI_RULES} Regulamin: <#${RULES_CHANNEL_ID}>\n` +
                    `${EMOJI_CONTEST} Konkursy: <#${CONTEST_CHANNEL_ID}>`
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`
                });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('member_count_info')
                    .setLabel(`👤 Jesteś naszym ${memberCount} użytkownikiem`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await channel.send({
                content: `<@${member.id}>`,
                embeds: [embed],
                components: [row]
            });

        } catch (err) {
            console.error('Błąd w welcome.js:', err);
        }
    });
};
