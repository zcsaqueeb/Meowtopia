import { delay, readFile } from './utils/helper.js';
import log from './utils/logger.js';
import bedduSalaam from './utils/banner.js';
import * as Kopi from './utils/api.js';


async function checkingUser(token, proxy, i) {
    try {
        log.info(`Trying to check user info...\n`);
        const userFarmres = await Kopi.getUserFarm(token, proxy);
        const farmingReward = userFarmres?.data?.farming_reward || 0;

        const userInfoRes = await Kopi.getUserInfo(token, proxy);
        const checkIn = await autoCheckin(token, userInfoRes, proxy, i)
        const userInfo = userInfoRes?.data || { user_name: 'unknown', asset_info: { diamond: 0, gacha_ticket: 0, METO: 0 } };
        const { user_name, asset_info } = userInfo;
        const { diamond, gacha_ticket, METO } = asset_info;
        log.info(`user info for account ${i + 1}:`, { user_name, diamond, gacha_ticket, METO, farmingReward })
        return { gacha_ticket, diamond, farmingReward };
    } catch (error) {
        log.info(`error when checking user info for account ${i + 1}:`, error.message);
        return { gacha_ticket: 0, diamond: 0, farmingReward: 0 };
    }
}


async function autoCheckin(token, response, proxy, i) {
    if (!response || !response.success) {
        return;
    }

    try {
        log.info(`Fetching user daily checkin...`);
        const claimedReward = response.data.week_reward
            .slice()
            .reverse()
            .find(daily => daily.tbl_user_7day.is_claim === 1);

        const lastCheckIn = claimedReward?.tbl_user_7day?.updated_at || null;
        const lastDay = claimedReward?.tbl_user_7day?.week_day_id || 0;

        const lastDateCheckIn = new Date(lastCheckIn).toISOString().split('T')[0];
        const currentDate = new Date().toISOString().split('T')[0];
        log.info(`Last Checkin for account #${i + 1}:`, `[ ${lastDateCheckIn} ]`)

        if (lastDateCheckIn !== currentDate) {
            log.info(`trying to daily checkin for account #${i + 1}...`);
            const daily = await Kopi.dailyClaim(token, lastDay + 1, proxy);
            log.info(`account #${i + 1} daily claim result:`, daily?.data || `Already Checkin for day ${lastDay + 1}`);
        } else {
            log.warn(`Skipping daily checkin for account #${i + 1}, already checked in today.`);
        }
    } catch (error) {
        log.error(`error when check in`, error.message)
    }
}

async function run() {
    log.info(bedduSalaam);
    await delay(3);

    const wallets = await readFile('accounts.txt');
    const proxies = await readFile('proxy.txt');

    if (wallets.length === 0) {
        log.error(`No Accounts Found - exiting program`);
        return;
    } else {
        log.info(`Running Program to all accounts:`, wallets.length);
    }

    while (true) {
        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            const proxy = proxies[i % proxies.length] || null;

            if (proxy) log.info(`Running account #${i + 1} with proxy:`, proxy);
            else log.info(`Running account #${i + 1} without proxy`);

            const loginRes = await Kopi.loginUser(wallet, proxy);
            const token = loginRes?.data?.access_token;
            if (!token) continue;
            let { gacha_ticket, diamond, farmingReward } = await checkingUser(token, proxy, i);

            while (gacha_ticket > 0) {
                log.info(`Trying Gatcha for account #${i + 1}...`);
                const gatchaRes = await Kopi.gatcha(token, wallet, proxy);
                const reward = gatchaRes?.data[0] || "ZONK";
                log.info(`account #${i + 1} gatcha result:`, reward);
                gacha_ticket--;
            }

            if (farmingReward > 1) {
                log.info(`trying to claiming farm Rewards for account #${i + 1}...`);
                const farmRes = await Kopi.claimFarm(token, proxy);
                const { idClaim, amount } = farmRes?.data || { idClaim: 0, amount: 0 };
                log.info(`account #${i + 1} claim farm response:`, { idClaim, amount });
            }

            await playingGame(token, proxy, i);
            await upgradeDecortion(token, diamond, proxy, i);
        }
        log.warn(`All accounts run completed, waiting 10 minutes for next run...`);
        await delay(10 * 60); // 10 minutes
    }
}


async function playingGame(token, proxy, i) {
    try {
        log.info(`Trying to Play Puzzle game account #${i + 1}...`)
        const playGameRes = await Kopi.playGame(token, proxy);
        const current_level = playGameRes?.data?.current_level || 31;
        log.info(`account #${i + 1} current level:`, current_level)
        const move = 10

        if (current_level <= 30) {
            try {
                const gameRes = await Kopi.submitGame(token, move, current_level, proxy);
                log.info(`account #${i + 1} game result:`, gameRes)
                const update = await Kopi.updateGame(token, proxy);
                log.info(`account #${i + 1} update puzzle to next level:`, update?.data?.info || {})
                await delay(1)
            } catch (error) {
                log.info(`account #${i + 1} error when play puzzle:`, error.message)
            }
        } else {
            log.warn('Already Reached Max-level for this account...')
        }
    } catch (error) {
        log.info(`account #${i + 1} error when play game:`, error.message)
    }
}

async function upgradeDecortion(token, diamond, proxy, i) {
    try {
        const roomRes = await Kopi.currentRoom(token, proxy);
        const room_id = roomRes?.data?.room_id || 0;
        if (room_id) {
            const availDecor = roomRes?.data?.decor;
            const unlockDecorIds = roomRes.data.decor.flatMap(item => item.unlock_decor);
            log.info(`account #${i + 1} number unlocked decoration skins:`, unlockDecorIds.length)

            const roomInfo = await Kopi.getUserRoomInfo(token, room_id, proxy);
            if (roomInfo) {
                const decor_limit = roomInfo?.data?.decor_limit || 100;
                const decorIds = roomInfo.data.decors.map(decor => decor.id);

                log.info(`account #${i + 1} available decoration for this room:`, decorIds.length)
                for (const decorId of decorIds) {

                    const decors = await Kopi.getUserDecor(token, decorId, proxy);
                    const list_skins = decors?.data?.list_skin || [];
                    if (list_skins.length === 0) continue;

                    for (const skin of list_skins) {
                        if (skin.type === 1 && skin.price > diamond) continue; // skip premium decor if not enough diamond 
                        else if (unlockDecorIds.includes(skin.id)) continue; // skip unlocked decor
                        log.info(`account #${i + 1} trying to build decorate:`, { room_id, decorId, skinId: skin.id })
                        const build = await Kopi.buidDecor(token, decorId, skin.id, room_id, proxy);
                        if (build === "Wait building") {
                            log.warn(`Already have pending building - skipping...`);
                            break;
                        }
                        if (skin.type === 1) {
                            diamond -= skin.price;
                        }
                        log.info(`build decoration result is success?`, build?.success || false)
                    };
                }

                if (decor_limit === availDecor.length) {
                    log.info(`Fetching Diamond price to upgrade the room account #${i + 1}...`);
                    const getCost = await Kopi.getRoomCost(token, room_id + 1, proxy);
                    const cost = getCost?.data[0]?.value || 0;
                    log.info(`account #${i + 1} Upgrade room cost:`, `${cost} DIAMOND | Current Diamond: ${diamond}`);
                    if (cost !== 0 && +cost < diamond) {
                        log.info(`Trying to upgrade room account #${i + 1}...`)
                        const updateRes = await Kopi.updateRoom(token, proxy);
                        log.info(`account #${i + 1} Upgrade Result:`, updateRes)
                    } else {
                        log.warn(`Not enought diamond to upgrade room...`)
                    }
                }
            }
        }

    } catch (error) {
        log.info(`error when upgrade decortion:`, error.message)
    }
}

run()
