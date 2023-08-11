import { handleObjectTag } from '../tags/object';

describe('handleObjectTag', () => {
  it('converts an object tag with properties to a JavaScript object', () => {
    const element = document.createElement('OBJECT');
    element.setAttribute('name', 'testObj');

    const result = handleObjectTag(element);

    expect(result).toBe(`const testObj = {};`);
  });

  it('returns null when the name attribute is missing', () => {
    const element = document.createElement('OBJECT');
    const result = handleObjectTag(element);
    expect(result).toBeNull();
  });
  
});
