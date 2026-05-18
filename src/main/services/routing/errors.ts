import { Data } from 'effect';

export class AirportUnknown extends Data.TaggedError('AirportUnknown')<{ iata: string }> {}
