declare module "*_agent-definitions.js" {
	const ALL_AGENTS: any[];
	export { ALL_AGENTS };
	export default ALL_AGENTS;
}
declare module "*_agent-behaviours.js" {
	export const BEHAVIOURS: any[];
	export const IMPACT: any;
	export const ROUTED_CAPABILITIES: string[];
	export const STATUS: any;
	export const VERDICT: any;
	export function auditRoster(...args: any[]): any;
	export function buildScorecard(...args: any[]): any;
	export function classifyAgent(...args: any[]): any;
	export function resolveBehaviour(...args: any[]): any;
}
declare module "*_workforce-core.js" {
	export function getRegistry(...args: any[]): any[];
	export function registerWorker(...args: any[]): any;
	export function runWorker(...args: any[]): Promise<any>;
}
declare module "*_workforce-workers.js" {
	const mod: any;
	export default mod;
}
declare module "*.js";
