/**
 * Names for the DAWs' own plugins. Logic stores short labels in its project
 * file; Ableton stores devices by XML tag. Anything not listed keeps its
 * stored name (Logic) or a spaced-out tag (Ableton).
 */

/** Logic Pro: label stored in ProjectData → name shown in Logic's plugin menu. */
export const LOGIC_BUILTIN_NAMES: Record<string, string> = {
  'St-Delay': 'Stereo Delay',
  'PShft': 'Pitch Shifter',
  'Space D': 'Space Designer',
  'VocalTrf': 'Vocal Transformer',
  'Bass Amp': 'Bass Amp Designer',
  'Amp': 'Amp Designer',
  'Dist II': 'Distortion II',
  'Mastering': 'Mastering Assistant',
  'AutoFilter': 'AutoFilter',
  'Chan EQ': 'Channel EQ',
  'LinPhase EQ': 'Linear Phase EQ',
  'Multipress': 'Multipressor',
  'Ad Limiter': 'Adaptive Limiter',
  'Pitch Corr': 'Pitch Correction',
}

/** Logic records that are not plugins anyone added (the metronome instrument). */
export const LOGIC_NOT_PLUGINS = new Set(['Klopfgeist'])

/** Logic instruments among its built-ins, so they can be listed as instruments. */
export const LOGIC_BUILTIN_INSTRUMENTS = new Set([
  'Alchemy', 'Sampler', 'Quick Sampler', 'ES1', 'ES2', 'ES E', 'ES M', 'ES P', 'EFM1', 'EVOC 20 PS', 'Retro Synth',
  'Sculpture', 'Ultrabeat', 'Drum Kit Designer', 'Drum Machine Designer', 'Drum Synth', 'Studio Piano', 'Studio Bass',
  'Studio Horns', 'Studio Strings', 'Vintage B3', 'Vintage Clav', 'Vintage Electric Piano', 'Vintage Mellotron',
  'Sample Alchemy',
])

export function logicBuiltinName(label: string): string {
  return LOGIC_BUILTIN_NAMES[label] ?? label
}

/** Ableton Live: device XML tag → name in Live's browser. */
export const ABLETON_DEVICE_NAMES: Record<string, string> = {
  Eq8: 'EQ Eight',
  Eq3: 'EQ Three',
  ChannelEq: 'Channel EQ',
  Compressor2: 'Compressor',
  GlueCompressor: 'Glue Compressor',
  MultibandDynamics: 'Multiband Dynamics',
  Limiter: 'Limiter',
  Gate: 'Gate',
  Reverb: 'Reverb',
  Hybrid: 'Hybrid Reverb',
  Delay: 'Delay',
  Echo: 'Echo',
  FilterDelay: 'Filter Delay',
  GrainDelay: 'Grain Delay',
  AutoFilter: 'Auto Filter',
  AutoPan: 'Auto Pan',
  Chorus2: 'Chorus-Ensemble',
  PhaserNew: 'Phaser-Flanger',
  Saturator: 'Saturator',
  Tube: 'Dynamic Tube',
  Overdrive: 'Overdrive',
  Pedal: 'Pedal',
  Amp: 'Amp',
  Cabinet: 'Cabinet',
  Redux2: 'Redux',
  Erosion: 'Erosion',
  Vinyl: 'Vinyl Distortion',
  BeatRepeat: 'Beat Repeat',
  Corpus: 'Corpus',
  FrequencyShifter: 'Frequency Shifter',
  Resonator: 'Resonators',
  Vocoder: 'Vocoder',
  StereoGain: 'Utility',
  SpectrumAnalyzer: 'Spectrum',
  Tuner: 'Tuner',
  DrumBuss: 'Drum Buss',
  Shifter: 'Shifter',
  Spectral: 'Spectral Time',
  SpectralResonator: 'Spectral Resonator',
  Roar: 'Roar',
  OriginalSimpler: 'Simpler',
  MultiSampler: 'Sampler',
  Operator: 'Operator',
  InstrumentVector: 'Wavetable',
  UltraAnalog: 'Analog',
  Collision: 'Collision',
  LoungeLizard: 'Electric',
  StringStudio: 'Tension',
  Drift: 'Drift',
  Meld: 'Meld',
  InstrumentImpulse: 'Impulse',
  DrumGroupDevice: 'Drum Rack',
  InstrumentGroupDevice: 'Instrument Rack',
  AudioEffectGroupDevice: 'Audio Effect Rack',
  MidiEffectGroupDevice: 'MIDI Effect Rack',
  MidiArpeggiator: 'Arpeggiator',
  MidiChord: 'Chord',
  MidiNoteLength: 'Note Length',
  MidiPitcher: 'Pitch',
  MidiRandom: 'Random',
  MidiScale: 'Scale',
  MidiVelocity: 'Velocity',
}

/** Ableton device tags that are instruments. */
export const ABLETON_INSTRUMENT_TAGS = new Set([
  'OriginalSimpler', 'MultiSampler', 'Operator', 'InstrumentVector', 'UltraAnalog', 'Collision', 'LoungeLizard',
  'StringStudio', 'Drift', 'Meld', 'InstrumentImpulse', 'DrumGroupDevice', 'InstrumentGroupDevice',
])

/** Ableton tags inside a Devices list that hold third-party plugins (counted separately) or aren't devices. */
export const ABLETON_SKIP_TAGS = new Set(['PluginDevice', 'AuPluginDevice', 'Vst3PluginDevice', 'MxDeviceAudioEffect', 'MxDeviceInstrument', 'MxDeviceMidiEffect'])

export function abletonDeviceName(tag: string): string {
  return ABLETON_DEVICE_NAMES[tag] ?? tag.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}
