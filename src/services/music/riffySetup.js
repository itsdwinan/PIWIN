import { createRequire } from 'module';
import { GatewayDispatchEvents } from 'discord.js';
import { logger } from '../../utils/logger.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import {
    setupPlayerHandler,
    restoreTwentyFourSevenPlayers,
} from './playerHandler.js';

const require = createRequire(import.meta.url);
const { Riffy } = require('riffy');

export function initializeMusic(client) {
    if (!lavalinkConfig.nodes?.length) {
        logger.error('No Lavalink nodes configured. Add lavalink/nodes.json, set LAVALINK_NODES, or set LAVALINK_HOST in your environment.');
        return;
    }

    client.riffy = new Riffy(client, lavalinkConfig.nodes, {
        send: (payload) => {
            const guildId = payload.d?.guild_id;
            if (!guildId) {
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            if (guild?.shard) {
                guild.shard.send(payload);
                return;
            }

            const shardCount = client.ws.shards.size || 1;
            const shardId = Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
            client.ws.shards.get(shardId)?.send(payload);
        },
        defaultSearchPlatform: lavalinkConfig.defaultSearchPlatform,
        restVersion: lavalinkConfig.restVersion,
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    setupPlayerHandler(client);

    client.on('raw', (packet) => {
        if (
            ![
                GatewayDispatchEvents.VoiceStateUpdate,
                GatewayDispatchEvents.VoiceServerUpdate,
            ].includes(packet.t)
        ) {
            return;
        }
        client.riffy.updateVoiceState(packet);
    });

    client.riffy.on('playerError', (player, error) => {
        logger.error(`Music player error in guild ${player.guildId}:`, error);
    });

    logger.info(`Music initialized with ${lavalinkConfig.nodes.length} Lavalink node(s).`);
}

export async function initRiffyAfterReady(client) {
    if (!client.riffy || !client.user?.id) {
        return;
    }

    let restored = false;

    const restoreWhenNodeReady = async () => {
        if (restored) {
            return;
        }

        const nodes = [
            ...(client.riffy.nodeMap?.values() || [])
        ];

        const hasConnectedNode = nodes.some((node) => node.connected);

        if (!hasConnectedNode) {
            logger.info('[24/7] Waiting for a connected Lavalink node...');
            return;
        }

        restored = true;

        client.riffy.off('nodeConnect', restoreWhenNodeReady);

        try {
            await restoreTwentyFourSevenPlayers(client);
        } catch (error) {
            logger.error('[24/7] Failed to restore players:', error);
        }
    };

    client.riffy.on('nodeConnect', restoreWhenNodeReady);

    client.riffy.init(client.user.id);

    logger.info('Riffy voice connection manager initialized.');

    // Coba langsung kalau node ternyata sudah connect.
    await restoreWhenNodeReady();
}
