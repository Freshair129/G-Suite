import { expect, it } from 'vitest';
import schema from '../../../../../schemas/gmaiden-events.json';
import { GMAIDEN_EVENTS } from './gmaiden-events';
it('authoring exposes every event the runtime can map in a GANN',()=>{
 expect(GMAIDEN_EVENTS.map(event=>event.id).sort()).toEqual(schema['x-events'].map(event=>event.id).sort());
});
