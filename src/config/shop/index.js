require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL']
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Memoria conversazioni per utente
const conversations = new Map();

const SYSTEM_PROMPT = `Sei l'assistente virtuale di uno studio di video editing professionale.
Il tuo compito è raccogliere le informazioni per un ordine video, UNA domanda alla volta.

Le informazioni da raccogliere in ordine sono:
1. Nome del cliente
2. Tipo di video (reel social, YouTube, matrimonio, aziendale, altro)
3. Durata stimata del video finale
4. Se hanno già il materiale girato oppure no
5. Stile desiderato (dinamico, elegante, minimal, ecc.)
6. Scadenza desiderata
7. Budget indicativo

Quando hai tutte le informazioni, mostra un riepilogo chiaro e chiedi conferma.
Dopo la conferma scrivi esattamente: ORDINE_CONFERMATO

Parla sempre in italiano, sii professionale ma cordiale. Inizia sempre presentandoti brevemente.`;

client.on('ready', () => {
  console.log(`Bot online come ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignora i messaggi del bot stesso
  if (message.author.bot) return;

  // Risponde solo se viene menzionato OPPURE in DM
  const isDM = message.channel.type === 1;
  const isMentioned = message.mentions.has(client.user);
  if (!isDM && !isMentioned) return;

  const userId = message.author.id;

  // Resetta la conversazione se l'utente scrive "reset"
  if (message.content.toLowerCase().includes('reset')) {
    conversations.delete(userId);
    await message.reply('Conversazione resettata! Scrivi di nuovo per iniziare un nuovo ordine.');
    return;
  }

  // Inizializza la storia se non esiste
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }

  const history = conversations.get(userId);

  // Rimuovi la menzione dal testo
  const userText = message.content.replace(/<@!?\d+>/g, '').trim();
  history.push({ role: 'user', content: userText || 'Ciao' });

  try {
    // Mostra che sta scrivendo
    await message.channel.sendTyping();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    // Manda la risposta (divisa se troppo lunga)
    if (reply.length > 2000) {
      const chunks = reply.match(/.{1,2000}/gs);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(reply);
    }

    // Se l'ordine è confermato, notifica te
    if (reply.includes('ORDINE_CONFERMATO')) {
      const notifyChannelId = process.env.NOTIFY_CHANNEL_ID;
      if (notifyChannelId) {
        const notifyChannel = await client.channels.fetch(notifyChannelId);
        const orderSummary = history
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .join('\n');
        await notifyChannel.send(
          `📦 **Nuovo ordine da ${message.author.username}!**\n\`\`\`${orderSummary}\`\`\``
        );
      }
      // Resetta la conversazione dopo l'ordine
      conversations.delete(userId);
    }

  } catch (error) {
    console.error('Errore:', error);
    await message.reply('Si è verificato un errore. Riprova tra poco!');
  }
});

client.login(process.env.DISCORD_TOKEN);
