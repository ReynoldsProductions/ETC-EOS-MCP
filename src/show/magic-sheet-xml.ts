/**
 * Read and write Eos magic sheet XML.
 *
 * Eos exports magic sheets as UTF-16 XML with a `<!DOCTYPE ETC>` line and a
 * SHOWFILE_VERSION attribute. `/eos/get/ms/*` over OSC returns metadata only — index,
 * UID and label, no geometry (see docs/eos-osc-findings.md §6) — so an exported file is
 * the only way to see or build what is actually on a sheet.
 *
 * The format is undocumented. Everything here was decoded from two exported sheets;
 * the enums below are the parts that have been confirmed against real files. Anything
 * still unknown is preserved verbatim on round-trip rather than guessed at, so
 * regenerating a sheet cannot silently drop attributes we do not understand yet.
 */
import { XMLParser, XMLBuilder } from "fast-xml-parser";

/** What a magic sheet object points at. Decoded from exported sheets. */
export const TargetType = {
  /** Decoration — no target. */
  None: 0,
  /** A cue. `listId` carries the cue list. */
  Cue: 2,
  Group: 3,
  /** A palette. `listId` selects which palette list — see PaletteList. */
  Palette: 6,
  Channel: 20,
} as const;

export type TargetTypeValue = (typeof TargetType)[keyof typeof TargetType];

/** TARGETLISTID values when TARGETTYPE is Palette. */
export const PaletteList = {
  Intensity: 1,
  Focus: 2,
  Colour: 3,
  Beam: 4,
} as const;

export interface MagicSheetTarget {
  type: number;
  id: number;
  /** Cue list for cues, palette list for palettes, -1 otherwise. */
  listId: number;
  mode: number;
}

export interface MagicSheetLinks {
  /** Non-zero makes the object outline follow live state. Exact enum not yet decoded. */
  penLink: number;
  /** Non-zero makes the object fill follow live state. Exact enum not yet decoded. */
  brushLink: number;
}

export interface MagicSheetItem {
  /** Object kind, e.g. "Symbol", "CPButton", "Button", "Pipe", "Polygon", "Text". */
  key: string;
  x: number;
  y: number;
  rotation: number;
  /** Label typed onto the object, as distinct from a label read from the target. */
  text: string;
  /** Command string fired on press, when the object is in command mode. */
  cmd: string;
  /** Symbol artwork path, when the object is a Symbol. */
  image: string | null;
  target: MagicSheetTarget;
  links: MagicSheetLinks;
  /** Live-data fields drawn on the object. FIELDTYPE enum is only partly decoded. */
  fieldTypes: number[];
  /**
   * The object's raw parsed node, kept so emit can round-trip attributes this module
   * does not model. Never mutated.
   */
  raw: unknown;
}

export interface MagicSheetViewport {
  scale: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface MagicSheet {
  showfileVersion: string;
  viewport: MagicSheetViewport;
  items: readonly MagicSheetItem[];
  /** Raw parsed document, kept for lossless emit. Never mutated. */
  raw: unknown;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-16"?>\n<!DOCTYPE ETC>\n';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string) => ["ITEM", "FIELD", "POINT"].includes(name),
} as const;

/**
 * Decode an exported sheet. Eos writes UTF-16LE with a BOM; Node's "utf16le" decoder
 * leaves the BOM in place as U+FEFF, which breaks an XML parser on the first character.
 */
export function decodeUtf16(bytes: Buffer | Uint8Array): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const isBigEndian = buffer[0] === 0xfe && buffer[1] === 0xff;
  if (isBigEndian) {
    // Swap to LE rather than mutating the caller's buffer.
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString("utf16le").replace(/^﻿/, "");
  }
  return buffer.toString("utf16le").replace(/^﻿/, "");
}

/** Encode a sheet back to the UTF-16LE-with-BOM that Eos expects on import. */
export function encodeUtf16(text: string): Buffer {
  return Buffer.from(`﻿${text}`, "utf16le");
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

type Node = Record<string, unknown>;

function asNode(value: unknown): Node {
  return value && typeof value === "object" ? (value as Node) : {};
}

function readItem(node: Node): MagicSheetItem {
  const data = asNode(node.ITEMDATA);
  const ms = asNode(data.MAGICSHEET);
  const target = asNode(ms.TARGET);
  const links = asNode(ms.LINKS);
  const text = asNode(ms.TEXT);
  const fields = asNode(ms.FIELDS);
  const fieldNodes = Array.isArray(fields.FIELD) ? (fields.FIELD as Node[]) : [];

  // Symbols carry their artwork path as element text; other objects have no IMG node.
  const img = data.IMG;
  const image =
    img === undefined || img === null || img === "" ? null : str(asNode(img)["#text"] ?? img);

  return {
    key: str(node["@_KEY"]),
    x: num(node["@_POSX"]),
    y: num(node["@_POSY"]),
    rotation: num(node["@_ROT"]),
    text: str(text["@_STR"]),
    cmd: str(ms["@_CMD"]),
    image,
    target: {
      type: num(target["@_TARGETTYPE"]),
      id: num(target["@_TARGETID"], -1),
      listId: num(target["@_TARGETLISTID"], -1),
      mode: num(target["@_MODE"]),
    },
    links: {
      penLink: num(links["@_PENLINK"]),
      brushLink: num(links["@_BRUSHLINK"]),
    },
    fieldTypes: fieldNodes.map((f) => num(f["@_FIELDTYPE"])),
    raw: node,
  };
}

/** Parse exported magic sheet XML. Throws if the document is not a magic sheet. */
export function parseMagicSheet(xml: string): MagicSheet {
  const parsed = new XMLParser(parserOptions).parse(xml) as Node;
  const sheet = asNode(parsed.MAGICSHEET);
  if (Object.keys(sheet).length === 0) {
    throw new Error("Not an Eos magic sheet: no <MAGICSHEET> element found.");
  }

  const viewportNode = asNode(asNode(sheet.VIEW).VIEWPORT);
  const itemList = asNode(asNode(sheet.ETCGRAPHICSSCENE).ITEMLIST);
  const itemNodes = Array.isArray(itemList.ITEM) ? (itemList.ITEM as Node[]) : [];

  return {
    showfileVersion: str(sheet["@_SHOWFILE_VERSION"]),
    viewport: {
      scale: num(viewportNode["@_SCALE"]),
      width: num(viewportNode["@_WIDTH"]),
      height: num(viewportNode["@_HEIGHT"]),
      x: num(viewportNode["@_POSX"]),
      y: num(viewportNode["@_POSY"]),
    },
    items: itemNodes.map(readItem),
    raw: parsed,
  };
}

/**
 * Serialise a sheet back to XML.
 *
 * Emits from the preserved raw document so attributes this module does not model
 * survive unchanged. Byte-for-byte equality with an Eos export is not a goal —
 * attribute order and whitespace differ — but the parsed content is identical, and
 * Eos reads attributes by name.
 */
export function emitMagicSheet(sheet: MagicSheet): string {
  const builder = new XMLBuilder({
    ...parserOptions,
    format: true,
    indentBy: " ",
    suppressEmptyNode: true,
  });
  // XML_HEADER carries the declaration, so drop the parsed one rather than emitting two.
  const { "?xml": _declaration, ...body } = asNode(sheet.raw);
  return `${XML_HEADER}${builder.build(body)}`;
}

/** Human-readable target description, for audit output. */
export function describeTarget(target: MagicSheetTarget): string {
  switch (target.type) {
    case TargetType.Channel:
      return `Channel ${target.id}`;
    case TargetType.Group:
      return `Group ${target.id}`;
    case TargetType.Cue:
      return `Cue ${target.listId} / ${target.id}`;
    case TargetType.Palette: {
      const names: Record<number, string> = {
        [PaletteList.Intensity]: "Intensity",
        [PaletteList.Focus]: "Focus",
        [PaletteList.Colour]: "Colour",
        [PaletteList.Beam]: "Beam",
      };
      const name = names[target.listId] ?? `Unknown-list-${target.listId}`;
      return `${name} Palette ${target.id}`;
    }
    case TargetType.None:
      return "no target";
    default:
      return `Unknown target type ${target.type} (id ${target.id})`;
  }
}
