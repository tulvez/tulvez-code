import { describe, expect, it } from 'vitest';

const { addTrailerToInput, removeTrailerFromInput } = await import('../services/coAuthorScm');
const { CO_AUTHOR_TRAILER } = await import('../services/gitIdentity');

describe('Kaynak Denetimi mesaj kutusu (Copilot gibi ek katkıcı)', () => {
  it('boş kutuya, kullanıcının yazacağı yer üstte kalacak şekilde ekler', () => {
    expect(addTrailerToInput('')).toBe(`\n\n${CO_AUTHOR_TRAILER}`);
  });

  it('yazılmış mesajın altına boş satırla ekler', () => {
    expect(addTrailerToInput('fix: retry eklendi\n')).toBe(`fix: retry eklendi\n\n${CO_AUTHOR_TRAILER}`);
  });

  it('zaten varsa ikinci kez eklemez', () => {
    const once = addTrailerToInput('fix: x');
    expect(addTrailerToInput(once)).toBe(once);
  });

  it('kaldırırken kullanıcının mesajına dokunmaz', () => {
    expect(removeTrailerFromInput(addTrailerToInput('feat: y\n\ngövde'))).toBe('feat: y\n\ngövde');
    expect(removeTrailerFromInput(addTrailerToInput(''))).toBe('');
  });

  it('başka ek katkıcıları (ör. Copilot) korur ve aynı ek bloğuna yazar', () => {
    const other = 'Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>';
    const msg = addTrailerToInput(`fix: z\n\n${other}`);
    // boş satır olmadan altına: git ikisini de ek satırı sayar
    expect(msg).toBe(`fix: z\n\n${other}\n${CO_AUTHOR_TRAILER}`);
    expect(removeTrailerFromInput(msg)).toBe(`fix: z\n\n${other}`);
  });

  it('tek paragraflık mesajda (başlıkta iki nokta olsa da) boş satır bırakır', () => {
    expect(addTrailerToInput('fix: x')).toBe(`fix: x\n\n${CO_AUTHOR_TRAILER}`);
  });
});
