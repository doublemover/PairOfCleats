import React from 'react';

export type FancyProps = {
  title: string;
};

export const FancyWidget = (props: FancyProps): JSX.Element => {
  return <div>{props.title}</div>;
};
