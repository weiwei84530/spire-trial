/**
 * Temporary entry point: runs a scripted demo battle in the console
 * to prove the headless engine works end to end. Replaced by the real
 * battle UI on Day 3.
 */
import { Battle } from './engine/battle';
import { makeStarterDeck, resolveCard } from './engine/cards';

const battle = new Battle({
  seed: Date.now() & 0xffffffff,
  deck: makeStarterDeck(),
  playerHp: 80,
  playerMaxHp: 80,
  enemies: ['cultist'],
});

// Greedy demo policy: play the most expensive affordable card, else end turn.
let safety = 200;
while (battle.state.phase === 'playerTurn' && safety-- > 0) {
  const target = battle.state.enemies.findIndex((e) => e.hp > 0);
  const playable = battle.state.player.hand
    .map((card, i) => ({ i, cost: resolveCard(card).cost }))
    .filter(({ i }) => battle.canPlay(i, target) || battle.canPlay(i))
    .sort((a, b) => b.cost - a.cost);
  if (playable.length === 0) {
    battle.endTurn();
  } else {
    const pick = playable[0]!;
    battle.playCard(pick.i, battle.canPlay(pick.i, target) ? target : undefined);
  }
}

console.log(battle.state.log.join('\n'));
console.log(`\nResult: ${battle.state.phase} on turn ${battle.state.turn}, player HP ${battle.state.player.hp}/${battle.state.player.maxHp}`);

document.querySelector('#app')!.innerHTML = `
  <h1>CardGame engine demo</h1>
  <p>戰鬥結果：<strong>${battle.state.phase}</strong>（第 ${battle.state.turn} 回合，玩家 HP ${battle.state.player.hp}/${battle.state.player.maxHp}）</p>
  <pre>${battle.state.log.join('\n')}</pre>
`;
