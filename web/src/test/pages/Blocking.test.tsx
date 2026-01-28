import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Blocking from '../../pages/Blocking';
import { RulesProvider } from '../../contexts/RulesContext';

describe('Filtering / blocking page', () => {
  it('renders without crashing', async () => {
    render(
      <RulesProvider>
        <Blocking />
      </RulesProvider>
    );

    expect(await screen.findByText('Gravity')).toBeInTheDocument();
  });
});
