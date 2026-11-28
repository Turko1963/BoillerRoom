// Execution profiles: what it would take to act on a plan at one broker. Configuration only: no connection, no API, no
// orders. A profile never changes the analysis or the saved prediction; it is applied on top, as a separate, versioned
// evaluation (server/execution/evaluate.js).
//
// Adding a broker = adding one profile object below (or in its own file, registered in PROFILES). The contract:
//   id, name, version         the profile's identity; bump the version when any field changes
//   selectable                'default' (NoBroker only) or 'manual' (a person picks it; never chosen automatically)
//   connected                 always false here: nothing in this app talks to a broker
//   instrumentKind            'cash' (the share itself) or 'cfd' (a contract on it: the instrument's underlying is the share)
//   symbolFor(instrument)     the broker's symbol: a field (unknown until the mapping is configured, with its source)
//   fields                    every cost and condition below, each a field() with status, provenance and date
// Fields: commission, spread, financingLong, financingShort (overnight, a year), fxConversion, contractMultiplier, lotSize,
// minNotional, margin, schedule (trading hours), availability (does it offer this instrument), shortable.
import { field, unknown } from './fields.js';

const ALL_UNKNOWN = note => ({
  commission: unknown('% of value a side', note), spread: unknown('% of price', note), financingLong: unknown('% a year', note), financingShort: unknown('% a year', note),
  fxConversion: unknown('% of value', note), contractMultiplier: unknown('units per contract', note), lotSize: unknown('units', note), minNotional: unknown('account currency', note),
  margin: unknown('% of value', note), schedule: unknown('trading hours', note), availability: unknown('offered or not', note), shortable: unknown('yes or no', note)
});

/** No broker: research and analysis only. Costs are not zero: they are absent, so nothing here is a net result. */
export const NO_BROKER = {
  id: 'nobroker', name: 'No broker (research only)', version: 1, selectable: 'default', connected: false, instrumentKind: 'cash',
  symbolFor: () => unknown('symbol', 'No broker: nothing is placed anywhere.'),
  fields: ALL_UNKNOWN('No broker is selected: research only, no costs are applied.'),
  label: 'Research only. Any result here is hypothetical and before costs: it is not a net result.'
};

/**
 * Colmex Israel, CFDs. Picked by hand only. No term is filled in: none has been verified from Colmex's published terms or
 * from the owner's account agreement. Fill a field with field(value, unit, 'configured', '<source>', '<date>') once one is.
 */
export const COLMEX_IL_CFD = {
  id: 'colmex-il-cfd', name: 'Colmex Israel CFD', version: 1, selectable: 'manual', connected: false, instrumentKind: 'cfd',
  symbolFor: () => unknown('symbol', "Colmex's symbol for this instrument is not configured."),
  fields: ALL_UNKNOWN("Not verified: needs Colmex's published terms or the account agreement, with the source and date."),
  label: 'Colmex Israel CFD, picked by hand. Not connected; no term verified yet, so costs and availability are unknown.'
};

export const PROFILES = { [NO_BROKER.id]: NO_BROKER, [COLMEX_IL_CFD.id]: COLMEX_IL_CFD };
export const profileFor = id => PROFILES[id] || null;
/** For the room: id, name, version, how it is selected, and that nothing is connected. */
export const listProfiles = () => Object.values(PROFILES).map(p => ({ id: p.id, name: p.name, version: p.version, selectable: p.selectable, connected: p.connected, instrumentKind: p.instrumentKind, label: p.label }));
export { field };
