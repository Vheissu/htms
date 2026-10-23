import { isPureExpression } from '../../src/component/dependencies';

describe('derived expression caching safety', () => {
  it.each([
    'this.count * 2',
    'this.items.map(item => item.price)',
    'this.items.reduce((sum, item) => sum + item.price, 0)',
    'this.items?.filter(item => item.active) ?? []',
    'Math.max(this.count, 0)',
    'Object.keys(this.settings)',
    'Array.from(this.items, item => item.price)',
  ])('recognizes a calculation without explicit side effects: %s', (source) => {
    expect(isPureExpression(source)).toBe(true);
  });

  it.each([
    'this.count++',
    'delete this.options.enabled',
    'Object.assign(this.target, this.source)',
    'Object.freeze(this.target)',
    'Reflect.set(this.target, "value", 1)',
    'this.items.map(this.callback)',
    'this.items.reduce(callback, 0)',
    'this.items.map((item = this.count++) => item)',
    'this.items[(this.count++, "map")](item => item)',
    'this.items.map(item => this.count++)',
    'Array.from(this.items, this.callback)',
    'JSON.parse(this.text, this.callback)',
    'this.slice()',
    'Date.now()',
    'Math.random()',
    'new Date()',
  ])('keeps unknown or mutating calculations eager: %s', (source) => {
    expect(isPureExpression(source)).toBe(false);
  });
});
