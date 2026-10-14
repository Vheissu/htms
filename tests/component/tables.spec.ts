import { parseHTML } from '../../src/parser';
import { mountComponent, query } from './test-utils';

describe('directives inside tables', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps a <repeat> of rows inside <tbody>', async () => {
    const element = await mountComponent(`
      <var name="rows" value='[{ "id": 1, "name": "Ada" }, { "id": 2, "name": "Lin" }]' mutable="true"></var>
      <table>
        <tbody>
          <repeat variable="rows" item="row" key="row.id">
            <tr><td>{row.id}</td><td>{row.name}</td></tr>
          </repeat>
        </tbody>
      </table>
    `);
    const cells = Array.from(element.shadowRoot.querySelectorAll('tbody td')).map(
      (cell) => cell.textContent
    );
    expect(cells).toEqual(['1', 'Ada', '2', 'Lin']);
    // Nothing was moved in front of the table.
    expect(query(element, 'table').previousElementSibling).toBeNull();
  });

  it('keeps branches between rows and cells', async () => {
    const element = await mountComponent(`
      <var name="admin" value="true" mutable="true"></var>
      <table>
        <tr>
          <td>Name</td>
          <if condition="admin"><td class="admin">Delete</td></if>
          <else><td class="guest">View</td></else>
        </tr>
      </table>
      <button id="toggle" on:click="admin = !admin">toggle</button>
    `);
    expect(element.shadowRoot.querySelectorAll('tr td')).toHaveLength(2);
    expect(query(element, 'tr td.admin').textContent).toBe('Delete');
    query(element, '#toggle').click();
    await element.updateComplete;
    expect(query(element, 'tr td.guest').textContent).toBe('View');
  });

  it('reports locations of directives inside tables', () => {
    const result = parseHTML(
      `<component name="table-errors">
  <table>
    <tbody>
      <repeat item="row"><tr><td>x</td></tr></repeat>
    </tbody>
  </table>
</component>`,
      { mode: 'component' }
    );
    expect(result.success).toBe(false);
    const error = result.errors.find((entry) => entry.tag === 'REPEAT');
    expect(error?.line).toBe(4);
  });

  it('leaves sources without tables untouched', () => {
    const source = `<component name="no-table"><ul><repeat variable="items" item="x"><li>{x}</li></repeat></ul><var name="items" value="[]" mutable="true"></var></component>`;
    const result = parseHTML(source, { mode: 'component' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('__htmsList(');
  });
});
