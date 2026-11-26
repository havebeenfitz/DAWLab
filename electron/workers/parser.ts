import { XMLParser } from 'fast-xml-parser';
import zlib from 'zlib';
import fs from 'fs';
import { ABLETON_INSTRUMENT_TAGS, ABLETON_SKIP_TAGS, abletonDeviceName } from './builtinPlugins';

export interface PluginInfo {
    name: string;
    manufacturer?: string;
    type?: string;
    is_instrument?: boolean;
    /** How many times the plugin is used in the project. */
    count?: number;
    /** One of the DAW's own plugins (Channel EQ, EQ Eight…), not a third-party one. */
    builtin?: boolean;
    /** Names of the tracks the plugin is used on, when the DAW's file says so reliably. */
    tracks?: string[];
}

export interface ExtractedMetadata {
    daw_version: string;
    tempo: number;
    time_signature: string;
    total_tracks: number;
    plugins: PluginInfo[];
    track_summary: {
        audio: string[];
        midi: string[];
        return: string[];
        group?: string[];
    };
}

export interface MetadataParser {
    parse(filePath: string): Promise<ExtractedMetadata>;
}

export class AbletonParser implements MetadataParser {
    constructor() {
        console.log('[AbletonParser] Running pure metadata-driven engine (v4)');
    }

    async parse(filePath: string): Promise<ExtractedMetadata> {
        console.log(`[AbletonParser] Parsing: ${filePath}`);
        return this.parseBuffer(fs.readFileSync(filePath));
    }

    /** Parses the bytes of an .als file (gzipped or plain XML). */
    parseBuffer(fileBuffer: Buffer): ExtractedMetadata {
        let xmlContent: string;

        try {
            xmlContent = zlib.gunzipSync(fileBuffer).toString('utf-8');
        } catch {
            xmlContent = fileBuffer.toString('utf-8');
        }

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            isArray: (name) => [
                'AudioTrack', 'MidiTrack', 'ReturnTrack', 'GroupTrack', 
                'AuPluginDevice', 'Vst3PluginDevice', 'PluginDevice'
            ].includes(name)
        });
        const jsonObj = parser.parse(xmlContent);

        if (!jsonObj.Ableton || !jsonObj.Ableton.LiveSet) {
            throw new Error('Invalid Ableton Live project file');
        }

        const liveSet = jsonObj.Ableton.LiveSet;

        // Metadata extraction
        const creator = jsonObj.Ableton['@_Creator'];
        const versionStr = creator ? creator : `Ableton Live ${jsonObj.Ableton['@_MajorVersion']}.${jsonObj.Ableton['@_MinorVersion']}`;
        const dawVersion = versionStr.startsWith('Ableton Live') ? versionStr : `Ableton Live ${versionStr}`;
        
        let tempo = 120;
        try {
            tempo = liveSet.MasterTrack?.DeviceChain?.Mixer?.Tempo?.Manual?.['@_Value'] || 120;
        } catch {}

        let timeSignature = '4/4';
        try {
            const num = liveSet.MasterTrack?.DeviceChain?.Mixer?.TimeSignature?.TimeSignature?.['@_Value'] || 4;
            timeSignature = `${num}/4`; 
        } catch {}

        const tracks = {
            audio: [] as string[],
            midi: [] as string[],
            return: [] as string[],
            group: [] as string[]
        };

        const processTracks = (trackEntries: any) => {
            if (!trackEntries) return;
            const extractNames = (trackArray: any, type: keyof typeof tracks) => {
                const arr = Array.isArray(trackArray) ? trackArray : trackArray ? [trackArray] : [];
                arr.forEach((t: any) => {
                    let name = 'Untitled Track';
                    if (t.Name) {
                        const userName = t.Name.UserName?.['@_Value'];
                        const effectiveName = t.Name.EffectiveName?.['@_Value'];
                        if (userName && String(userName).trim() !== '') {
                            name = userName;
                        } else if (effectiveName) {
                            name = effectiveName;
                        }
                    }
                    tracks[type].push(name);
                });
            };
            extractNames(trackEntries.AudioTrack, 'audio');
            extractNames(trackEntries.MidiTrack, 'midi');
            extractNames(trackEntries.ReturnTrack, 'return');
            extractNames(trackEntries.GroupTrack, 'group');
        };

        processTracks(liveSet.Tracks);

        // Exhaustive Search, then the tracks each plugin sits on
        const pluginsList = this.withTracks(liveSet, [...this.findPlugins(jsonObj), ...this.findNativeDevices(jsonObj)]);
        console.log(`[AbletonParser] Found ${pluginsList.length} unique plugins`);

        return {
            daw_version: dawVersion,
            tempo: parseFloat(Number(tempo).toFixed(2)),
            time_signature: timeSignature,
            total_tracks: tracks.audio.length + tracks.midi.length + tracks.return.length + tracks.group.length,
            plugins: pluginsList,
            track_summary: tracks
        };
    }

    /** Adds to each plugin the names of the tracks (including returns and the main track) whose chains use it, racks included. */
    private withTracks(liveSet: any, plugins: PluginInfo[]): PluginInfo[] {
        const asArray = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);
        const trackName = (t: any, fallback: string) => {
            const user = t?.Name?.UserName?.['@_Value'];
            const effective = t?.Name?.EffectiveName?.['@_Value'];
            return String(user && String(user).trim() ? user : effective || fallback).trim();
        };
        const owners: Array<{ name: string; node: any }> = [];
        for (const kind of ['AudioTrack', 'MidiTrack', 'GroupTrack', 'ReturnTrack']) {
            for (const t of asArray(liveSet.Tracks?.[kind])) owners.push({ name: trackName(t, 'Untitled Track'), node: t });
        }
        const main = liveSet.MasterTrack ?? liveSet.MainTrack;
        if (main) owners.push({ name: trackName(main, 'Main'), node: main });

        const key = (p: PluginInfo) => `${p.builtin ? 'b' : 'p'}|${(p.manufacturer ?? '').toLowerCase()}|${p.name.toLowerCase()}`;
        const tracksOf = new Map<string, string[]>();
        for (const { name, node } of owners) {
            for (const p of [...this.findPlugins(node), ...this.findNativeDevices(node)]) {
                const list = tracksOf.get(key(p)) ?? [];
                if (!list.includes(name)) tracksOf.set(key(p), [...list, name]);
            }
        }
        return plugins.map((p) => (tracksOf.has(key(p)) ? { ...p, tracks: tracksOf.get(key(p)) } : p));
    }

    /** Live's own devices (EQ Eight, Operator, racks…), counted per instance, wherever they sit (tracks, racks, chains). */
    private findNativeDevices(root: any): PluginInfo[] {
        const byName = new Map<string, PluginInfo>();
        const stack: any[] = [root];
        while (stack.length > 0) {
            const obj = stack.pop();
            if (!obj || typeof obj !== 'object') continue;
            if (Array.isArray(obj)) { for (const v of obj) stack.push(v); continue; }
            for (const [k, v] of Object.entries(obj)) {
                if (k.startsWith('@_') || !v || typeof v !== 'object') continue;
                if (k === 'Devices' && !Array.isArray(v)) {
                    for (const [tag, dev] of Object.entries(v as Record<string, any>)) {
                        if (tag.startsWith('@_') || ABLETON_SKIP_TAGS.has(tag) || !dev || typeof dev !== 'object') continue;
                        const instances = Array.isArray(dev) ? dev.length : 1;
                        const name = abletonDeviceName(tag);
                        const seen = byName.get(name);
                        if (seen) seen.count = (seen.count ?? 1) + instances;
                        else byName.set(name, { name, manufacturer: 'Ableton', type: 'Live', is_instrument: ABLETON_INSTRUMENT_TAGS.has(tag), builtin: true, count: instances });
                    }
                }
                stack.push(v);
            }
        }
        return [...byName.values()];
    }

    private findPlugins(root: any): PluginInfo[] {
        const pluginsList: PluginInfo[] = [];
        const seenKeys = new Map<string, PluginInfo>();
        const stack: any[] = [root];

        while (stack.length > 0) {
            const obj = stack.pop();
            if (!obj || typeof obj !== 'object') continue;

            if (obj.PluginDesc) {
                const pd = obj.PluginDesc;
                let type: string | undefined;
                let info: any;

                if (pd.Vst3PluginInfo) { type = "VST3"; info = pd.Vst3PluginInfo; }
                else if (pd.VstPluginInfo) { type = "VST2"; info = pd.VstPluginInfo; }
                else if (pd.AuPluginInfo) { type = "AU"; info = pd.AuPluginInfo; }

                if (type && info) {
                    // Logic Priority 1: Direct from info block
                    const nameTag = (type === "VST2") ? "PlugName" : "Name";
                    let name = info[nameTag]?.['@_Value'] || "";
                    
                    // Logic Priority 2: Fallback recursive search in PluginDesc
                    if (!name || name === "") {
                        name = this.findFirstValue(pd, ["Name", "PlugName", "EffectiveName", "UserName"]) || "Unknown";
                    }

                    // Manufacturer Priority 1: Direct child
                    let manufacturer = info.Manufacturer?.['@_Value'] || "";
                    
                    // Manufacturer Priority 2: Anywhere within PluginDesc
                    if (!manufacturer || manufacturer === "") {
                        manufacturer = this.findFirstValue(pd, ["Manufacturer"]) || "";
                    }

                    // Manufacturer Priority 3: BrowserContentPath fallback
                    if (!manufacturer || manufacturer === "") {
                        const bpath = this.findFirstValue(pd, ["BrowserContentPath"]);
                        if (bpath) {
                            const match = bpath.match(/#([^:]+):/);
                            if (match) manufacturer = decodeURIComponent(match[1].replace(/%20/g, ' '));
                        }
                    }

                    if (manufacturer === "") manufacturer = "Unknown";

                    // Strict Instrument vs Effect
                    let isInstrument = false;
                    const bdid = this.findFirstValue(obj, ["BranchDeviceId"]);
                    if (bdid) {
                        if (bdid.includes(':instr:')) isInstrument = true;
                        else if (bdid.includes(':audiofx:')) isInstrument = false;
                    }

                    if (name !== "Unknown") {
                        const key = `${name}|${manufacturer}|${type}|${isInstrument}`.toLowerCase();
                        const seen = seenKeys.get(key);
                        if (seen) {
                            seen.count = (seen.count ?? 1) + 1;
                        } else {
                            const plugin: PluginInfo = { name, manufacturer, type, is_instrument: isInstrument, count: 1 };
                            seenKeys.set(key, plugin);
                            pluginsList.push(plugin);
                        }
                    }
                }
            }

            // Recursive traversal
            if (Array.isArray(obj)) {
                for (let i = obj.length - 1; i >= 0; i--) stack.push(obj[i]);
            } else {
                for (const k of Object.keys(obj)) {
                    if (k.startsWith('@_')) continue;
                    if (obj[k] && typeof obj[k] === 'object') stack.push(obj[k]);
                }
            }
        }
        return pluginsList;
    }

    private findFirstValue(root: any, tags: string[]): string | null {
        const stack: any[] = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            for (const t of tags) {
                if (node[t] && node[t]['@_Value'] !== undefined) {
                    const v = String(node[t]['@_Value']).trim();
                    if (v !== "") return v;
                }
            }
            if (Array.isArray(node)) {
                for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
            } else {
                for (const k of Object.keys(node)) {
                    if (k.startsWith('@_')) continue;
                    if (node[k] && typeof node[k] === 'object') stack.push(node[k]);
                }
            }
        }
        return null;
    }
}
