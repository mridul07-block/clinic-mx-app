import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';

/**
 * Backup encryption (FND-13) with age, by its author's library. Copies are encrypted to a public
 * key (the `BACKUP_AGE_RECIPIENT` repository variable); only the offline private key reads them,
 * so nothing on GitHub can. X25519 keys, which the `age` command line tool also reads. Streamed,
 * so a copy of any size never sits whole in memory.
 */
export async function generateKeyPair(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

const webIn = (path: string) =>
  Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
const webOut = (path: string) =>
  Writable.toWeb(createWriteStream(path)) as WritableStream<Uint8Array>;

export async function encryptFile(from: string, to: string, recipient: string): Promise<void> {
  if (!recipient.startsWith('age1')) throw new Error('The recipient is not an age public key');
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  await (await encrypter.encrypt(webIn(from))).pipeTo(webOut(to));
}

export async function decryptFile(from: string, to: string, identity: string): Promise<void> {
  if ((await stat(from)).size === 0) throw new Error(`${from} is empty`);
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity.trim());
  await (await decrypter.decrypt(webIn(from))).pipeTo(webOut(to));
}
