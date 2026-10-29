import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter, Route } from 'react-router-dom';
import { DepartmentCard, DepartmentGrid } from '../pages/Departments';

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
});

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const cardiology = { id: 2, name: 'Cardiology', slug: 'cardiology', shortDescription: 'Heart health.', icon: 'heart', doctorCount: 1 };

test('a department card is one link to its own page', () => {
  act(() => {
    ReactDOM.render(<MemoryRouter><DepartmentCard department={cardiology} /></MemoryRouter>, container);
  });
  const links = container.querySelectorAll('a');
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute('href')).toBe('/departments/cardiology');
  expect(links[0].textContent).toContain('Cardiology');
  expect(links[0].textContent).toContain('1 doctor');
});

test('clicking a card opens the department route', () => {
  let location;
  act(() => {
    ReactDOM.render(
      <MemoryRouter>
        <DepartmentCard department={cardiology} />
        <Route render={props => { location = props.location; return null; }} />
      </MemoryRouter>, container);
  });
  act(() => { Simulate.click(container.querySelector('a'), { button: 0 }); });
  expect(location.pathname).toBe('/departments/cardiology');
});

test('the grid shows one card per department from the server', async () => {
  global.fetch = jest.fn(() => respond(200, { data: [cardiology, { ...cardiology, id: 3, name: 'ENT', slug: 'ent', doctorCount: 0 }] }));
  await act(async () => {
    ReactDOM.render(<MemoryRouter><DepartmentGrid /></MemoryRouter>, container);
  });
  const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
  expect(hrefs).toEqual(['/departments/cardiology', '/departments/ent']);
  expect(container.textContent).toContain('No doctors yet');
});

test('a failed load shows an error with a retry button that loads again', async () => {
  global.fetch = jest.fn(() => respond(503, { error: 'The hospital system is temporarily unavailable.' }));
  await act(async () => {
    ReactDOM.render(<MemoryRouter><DepartmentGrid /></MemoryRouter>, container);
  });
  expect(container.textContent).toContain('temporarily unavailable');
  global.fetch = jest.fn(() => respond(200, { data: [cardiology] }));
  await act(async () => { Simulate.click([...container.querySelectorAll('button')].find(b => /try again/i.test(b.textContent))); });
  expect(container.querySelector('a').getAttribute('href')).toBe('/departments/cardiology');
});
