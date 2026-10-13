/**
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
// @vitest-environment jsdom

import {
  isContentDuplicated,
  seedSharedDocument,
} from "../../blocknote/collaborationSeed";
import { BlockNoteEditor } from "@blocknote/core";
import { beforeAll, describe, expect, test } from "vitest";
import {
  Doc,
  XmlElement,
  XmlText,
  applyUpdate,
  encodeStateAsUpdate,
} from "yjs";
import type { BlockType, EditorType } from "../../blocknote";
import type { Collaboration } from "@xwiki/platform-collaboration-api";

const FRAGMENT = "content";

let editor: EditorType;

beforeAll(() => {
  editor = BlockNoteEditor.create() as unknown as EditorType;
});

/**
 * @param synced - whether the session has been synchronized with the collaboration server
 * @returns a collaboration session holding an empty shared document
 */
function createSession(synced: boolean): Collaboration {
  return {
    doc: new Doc(),
    // A plain holder rather than a Vue ref: this package doesn't depend on Vue, and the seed only reads the value.
    synced: { value: synced },
  } as unknown as Collaboration;
}

/**
 * Merges two shared documents both ways, the way the collaboration server does once both clients are connected.
 */
function merge(left: Doc, right: Doc): void {
  applyUpdate(left, encodeStateAsUpdate(right));
  applyUpdate(right, encodeStateAsUpdate(left));
}

function getText(doc: Doc): string {
  return doc.getXmlFragment(FRAGMENT).toJSON();
}

function paragraph(id: string, text: string): BlockType {
  return { id, type: "paragraph", content: text } as unknown as BlockType;
}

/**
 * Appends a paragraph to the shared document, standing for what a user types on top of the seed.
 */
function type(doc: Doc, text: string): void {
  const block = new XmlElement("paragraph");
  block.insert(0, [new XmlText(text)]);
  const fragment = doc.getXmlFragment(FRAGMENT);
  fragment.insert(fragment.length, [block]);
}

/**
 * Creates a session, seeds it with the given content and appends a paragraph on top of the seed.
 */
function seedAndType(
  content: BlockType[],
  synced: boolean,
  text: string,
): Collaboration {
  const session = createSession(synced);
  seedSharedDocument(editor, session, FRAGMENT, content);
  type(session.doc, text);
  return session;
}

describe("seedSharedDocument", () => {
  test("seeds a session nobody has seeded yet", () => {
    const session = createSession(true);
    seedSharedDocument(editor, session, FRAGMENT, [paragraph("b0", "Hello")]);
    expect(getText(session.doc)).toContain("Hello");
  });

  test("doesn't seed a synchronized session that already holds the content", () => {
    const content = [paragraph("b0", "Hello")];
    const first = createSession(true);
    seedSharedDocument(editor, first, FRAGMENT, content);

    // A second client joins that session and finds it already seeded.
    const second = createSession(true);
    applyUpdate(second.doc, encodeStateAsUpdate(first.doc));
    seedSharedDocument(editor, second, FRAGMENT, content);

    expect(getText(second.doc).match(/Hello/g)).toHaveLength(1);
    expect(isContentDuplicated(second)).toBe(false);
  });

  test("merges the seed of a client that couldn't reach the session", () => {
    const content = [paragraph("b0", "Hello")];

    // One client is in the session, another one seeds the same content without having reached it. Both of them change
    // something, then the offline one gets connected.
    const online = seedAndType(content, true, "from the session");
    const offline = seedAndType(content, false, "while offline");
    merge(online.doc, offline.doc);

    // The content they started from is there once, and both sets of changes survived.
    expect(getText(online.doc)).toEqual(getText(offline.doc));
    expect(getText(online.doc).match(/Hello/g)).toHaveLength(1);
    expect(getText(online.doc)).toContain("from the session");
    expect(getText(online.doc)).toContain("while offline");
    expect(isContentDuplicated(online)).toBe(false);
  });

  test("reports the content as duplicated when the seeds differ", () => {
    const online = createSession(true);
    seedSharedDocument(editor, online, FRAGMENT, [paragraph("b0", "Hello")]);
    // This client loaded a different version of the page before failing to reach the session.
    const offline = createSession(false);
    seedSharedDocument(editor, offline, FRAGMENT, [
      paragraph("b0", "Hello"),
      paragraph("b1", "Goodbye"),
    ]);

    merge(online.doc, offline.doc);

    // Nothing is lost and both clients agree, but the content they started from is there twice.
    expect(getText(online.doc)).toEqual(getText(offline.doc));
    expect(getText(online.doc)).toContain("Goodbye");
    expect(isContentDuplicated(online)).toBe(true);
  });
});
