import balance from '../../../shared/balance.json';
import { ACTIONS } from '../controls/actions.js';

const SKILLS = [
  { action: 'strike', move: 'light_1', name: 'Light strike', x: 16, y: 26, group: 'Weapon' },
  { action: 'heavy', move: 'heavy_1', name: 'Heavy strike', x: 38, y: 14, group: 'Weapon' },
  { action: 'dodge', move: 'dodge', name: 'Dodge', x: 38, y: 40, group: 'Movement' },
  { action: 'strike', move: 'bend_palm', name: 'Palm strike', x: 62, y: 14, group: 'Bending' },
  { action: 'rise', move: 'uppercut', name: 'Rising blow', x: 62, y: 40, group: 'Bending' },
  { action: 'ground', move: 'ground_pound', name: 'Ground strike', x: 84, y: 14, group: 'Bending' },
  { action: 'bend_move', move: 'dash_strike', name: 'Dash strike', x: 84, y: 40, group: 'Bending' },
  { action: 'ultimate', move: 'ultimate', name: 'Ultimate', x: 73, y: 72, group: 'Bending' },
  { action: 'spark', move: 'shard_spark', name: 'Shard spark', x: 27, y: 72, group: 'Hush' },
] as const;

const REQUIRED = (balance.combat as { tiers: { required: Record<string, number>; names: string[] } }).tiers;

export function abilitiesMarkup(element: string, isDim: boolean, tier: number): string {
  const tierName = REQUIRED.names[tier - 1] ?? REQUIRED.names[0];
  return `
    <section class="abilities-screen" aria-label="Level and abilities">
      <div class="ability-tree-wrap">
        <div class="ability-heading"><div><span class="atlas-kicker">Character progression</span><h2>Abilities</h2></div><span class="ability-element" data-element="${element.toLowerCase()}">${isDim ? 'HUSH' : element}</span></div>
        <div class="ability-tier-row" aria-label="Current combat tier">
          <div><span>Current tier</span><strong>Tier ${tier} · ${tierName}</strong></div>
          <ol class="tier-steps" aria-label="Seven combat tiers">${REQUIRED.names.map((name, index) => `<li class="${index + 1 < tier ? 'tier-past' : ''} ${index + 1 === tier ? 'tier-current' : ''}" aria-label="Tier ${index + 1}: ${name}${index + 1 === tier ? ', current' : ''}"><span>${index + 1}</span></li>`).join('')}</ol>
        </div>
        <div class="ability-tree" role="group" aria-label="Combat techniques and tier requirements">
          <svg class="ability-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M16 26 L38 14 L62 14 L84 14 M16 26 L38 40 L62 40 L84 40 M27 72 L62 40 L73 72 M62 14 L73 72" /></svg>
          ${SKILLS.map((skill, index) => {
            const action = ACTIONS.find(item => item.id === skill.action)!;
            const required = REQUIRED.required[skill.move] ?? 1;
            const roleBlocked = (isDim && skill.group === 'Bending') || (!isDim && skill.group === 'Hush');
            const locked = tier < required || roleBlocked;
            return `<button type="button" class="skill-node ${locked ? 'is-locked' : 'is-open'}" style="--node-x:${skill.x}%;--node-y:${skill.y}%" data-skill="${skill.action}" data-name="${skill.name}" data-control="${action.key}" data-tier="${required}" data-group="${skill.group}" data-locked="${locked}" aria-pressed="false" aria-label="${skill.name}, ${locked ? roleBlocked ? 'not available to this role' : `unlocks at tier ${required}` : 'available'}"><span class="skill-node-glyph" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span></button>`;
          }).join('')}
        </div>
        <p class="ability-legend"><span class="legend-open"></span> Available <span class="legend-locked"></span> Locked by tier or role</p>
      </div>
      <aside class="ability-detail" aria-live="polite">
        <span class="atlas-kicker">Technique details</span><h3 class="skill-title">Choose a technique</h3>
        <p class="skill-description">Select a node to see its control and tier requirement. Skill access follows the current combat rules.</p>
        <dl><div><dt>Discipline</dt><dd class="skill-group">—</dd></div><div><dt>Requirement</dt><dd class="skill-requirement">—</dd></div><div><dt>Control</dt><dd class="skill-control">—</dd></div></dl>
      </aside>
    </section>`;
}

export function bindAbilities(root: ParentNode): void {
  const nodes = [...root.querySelectorAll<HTMLButtonElement>('.skill-node')];
  const title = root.querySelector<HTMLElement>('.skill-title');
  const group = root.querySelector<HTMLElement>('.skill-group');
  const requirement = root.querySelector<HTMLElement>('.skill-requirement');
  const control = root.querySelector<HTMLElement>('.skill-control');
  const description = root.querySelector<HTMLElement>('.skill-description');
  const tierNames = REQUIRED.names;
  nodes.forEach(node => node.addEventListener('click', () => {
    nodes.forEach(item => {
      item.setAttribute('aria-pressed', String(item === node));
      item.classList.toggle('is-selected', item === node);
    });
    const locked = node.dataset.locked === 'true';
    const tier = Number(node.dataset.tier);
    if (title) title.textContent = node.dataset.name ?? 'Technique';
    if (group) group.textContent = node.dataset.group ?? '—';
    if (requirement) requirement.textContent = locked ? `Tier ${tier} · ${tierNames[tier - 1] ?? 'Unknown'}` : 'Available at your current tier';
    if (control) control.textContent = node.dataset.control ?? '—';
    if (description) description.textContent = locked ? 'This technique is part of the combat kit. It becomes available when its tier requirement is met.' : 'This technique is available in combat. Its control is shown below.';
  }));
}
