/**
 * The minds' clock. ECONOMY_CLOCK_SPEED runs it faster than wall time (a development setting for watching the
 * phases turn); 1 by default. The loop, the router's budgets and the conversations all read this one clock.
 */
const speed = Number(process.env.ECONOMY_CLOCK_SPEED) || 1;
const start = Date.now();

export const economyNow = (): number => (speed === 1 ? Date.now() : start + (Date.now() - start) * speed);
