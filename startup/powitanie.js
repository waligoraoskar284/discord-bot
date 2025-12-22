const { EmbedBuilder, Events } = require('discord.js');

// ID kanałów
const WELCOME_CHANNEL_ID = '1452583080333410455';
const RULES_CHANNEL_ID = '1452645730102677555';
const CONTEST_CHANNEL_ID = '1321027576277499944';

module.exports = (client) => {
    // Reagujemy na dołączenie nowego członka
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;

            const embed = new EmbedBuilder()
                .setColor('#00FF7F') // zielony kolor
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                .setDescription(`👋 Witaj ${member} na serwerze!\n❗ Zapoznaj się z naszym regulaminem na <#${RULES_CHANNEL_ID}>\n➡️ ︲ Psst! Sprawdź Konkursy! Może coś czeka na <#${CONTEST_CHANNEL_ID}>`)
                .addFields({ name: 'Sprawdziany & Kartkówki Powitalnia', value: formattedDate })
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: 'Miłego pobytu na serwerze!' });

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('Błąd w welcome.js:', err);
        }
    });
};
