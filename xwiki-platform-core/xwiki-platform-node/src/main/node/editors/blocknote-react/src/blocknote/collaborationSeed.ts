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
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { Doc, applyUpdate, encodeStateAsUpdate } from "yjs";
import type { BlockType, EditorType } from "./index";
import type { Collaboration } from "@xwiki/platform-collaboration-api";

/**
 * The map, shared by every participant of a collaboration session, where the seeds the session was initialized from
 * are recorded.
 */
const CONFIGURATION_MAP = "configuration";

/**
 * The prefix of the keys recording a seed, under which the identifier of the seeded content is stored. Each seed gets
 * its own key, rather than all of them sharing one, so that seeds applied concurrently don't overwrite each other and
 * we can tell afterwards how many distinct ones the session received.
 */
const SEED_KEY_PREFIX = "seed:";

/**
 * Loads the initial content into the shared document of a collaboration session, unless the session already holds it.
 *
 * The content is loaded through a seed whose Yjs client identifier is derived from the content itself, which makes the
 * operation convergent: two participants that seed the same content produce the very same Yjs items, so merging their
 * documents keeps one copy of the content instead of two. This is what lets a participant that couldn't reach the
 * collaboration server start editing right away: it seeds its own document, and once the connection is established
 * what it typed is merged into the session rather than duplicating the content it started from.
 *
 * @param editor - the editor whose schema is used to convert the content
 * @param collaboration - the collaboration session to seed
 * @param fragmentName - the name of the shared fragment the editor is bound to
 * @param content - the initial content, as loaded from the saved document
 */
function seedSharedDocument(
  editor: EditorType,
  collaboration: Collaboration,
  fragmentName: string,
  content: BlockType[],
): void {
  const configuration = collaboration.doc.getMap(CONFIGURATION_MAP);
  // Only the session can tell us that it already holds the content. While we haven't heard from it we have to assume
  // it doesn't, otherwise we would show an empty editor for as long as the server is unreachable.
  if (collaboration.synced.value && isSeeded(collaboration)) {
    return;
  }

  const seedId = getSeedId(content);
  console.debug("Seeding the realtime collaboration session.", seedId, content);
  const seedDocument = new Doc();
  // Yjs identifies an item by its client identifier and its clock, so seeding under an identifier derived from the
  // content is what makes two identical seeds indistinguishable, and therefore merge into one.
  seedDocument.clientID = seedId;
  blocksToYXmlFragment(
    editor,
    content,
    seedDocument.getXmlFragment(fragmentName),
  );
  applyUpdate(collaboration.doc, encodeStateAsUpdate(seedDocument));
  configuration.set(`${SEED_KEY_PREFIX}${seedId}`, true);
}

/**
 * @param collaboration - the collaboration session to check
 * @returns whether the initial content has been loaded into the shared document of the given session
 */
function isSeeded(collaboration: Collaboration): boolean {
  return getSeedIds(collaboration).length > 0;
}

/**
 * Tells whether the shared document was seeded more than once, from contents that differ. This happens when a
 * participant seeds a session it couldn't reach yet, and that session turns out to have been seeded from a different
 * version of the document: both contents are then present, one after the other. No change is lost, but the document
 * holds each of them once and somebody has to remove the one they don't want.
 *
 * @param collaboration - the collaboration session to check
 * @returns whether the shared document holds more than one version of the initial content
 * @since 18.9.0RC1
 * @beta
 */
function isContentDuplicated(collaboration: Collaboration): boolean {
  return getSeedIds(collaboration).length > 1;
}

function getSeedIds(collaboration: Collaboration): string[] {
  return Array.from(collaboration.doc.getMap(CONFIGURATION_MAP).keys()).filter(
    (key) => key.startsWith(SEED_KEY_PREFIX),
  );
}

/**
 * @param content - the content to identify
 * @returns a 32 bit identifier of the given content, which is the range Yjs client identifiers live in
 */
function getSeedId(content: BlockType[]): number {
  const serializedContent = JSON.stringify(content);
  // FNV-1a, for no reason other than being short and spreading well enough for what we need: two contents that differ
  // have to get different identifiers, so that their seeds stay distinguishable instead of corrupting each other.
  let hash = 0x811c9dc5;
  for (let i = 0; i < serializedContent.length; i++) {
    hash ^= serializedContent.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export { isContentDuplicated, seedSharedDocument };
