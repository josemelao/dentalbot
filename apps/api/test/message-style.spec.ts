import {
  configureMessageStyle,
  pick,
  setMessageRandom,
  withEmoji,
} from '../src/common/message-style';

describe('message style', () => {
  afterEach(() => {
    setMessageRandom(() => 0);
    configureMessageStyle({ emoji: true });
  });

  it('picks the first variant with a deterministic random', () => {
    setMessageRandom(() => 0);
    expect(pick(['a', 'b', 'c'])).toBe('a');
  });

  it('varies with a different random value', () => {
    setMessageRandom(() => 0.9);
    expect(pick(['a', 'b', 'c'])).toBe('c');
  });

  it('always returns the only variant', () => {
    setMessageRandom(() => 0.9);
    expect(pick(['unica'])).toBe('unica');
  });

  it('drops the emoji when the clinic does not want them', () => {
    configureMessageStyle({ emoji: false });
    expect(withEmoji('Prontinho!', '✅')).toBe('Prontinho!');

    configureMessageStyle({ emoji: true });
    expect(withEmoji('Prontinho!', '✅')).toBe('Prontinho! ✅');
  });
});
