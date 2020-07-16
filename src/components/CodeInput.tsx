import React, {useCallback, useState} from 'react';

import {Box} from './Box';
import {TextInput} from './TextInput';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
}

export const CodeInput = ({value, onChange, accessibilityLabel}: CodeInputProps) => {
  const onChangeTrimmed = useCallback(text => onChange(text.trim()), [onChange]);
  const [isFocus, setIsFocus] = useState(false);
  const onFocus = useCallback(() => setIsFocus(true), []);
  const onBlur = useCallback(() => setIsFocus(false), []);

  return (
    <>
      <Box
        marginHorizontal="none"
        borderRadius={9}
        borderWidth={4}
        borderColor={isFocus ? 'focus' : 'overlayBackground'}
      >
        <Box
          flex={1}
          paddingHorizontal="xs"
          borderWidth={2}
          borderColor={isFocus ? 'overlayBodyText' : 'gray2'}
          borderRadius={5}
        >
          <TextInput
            value={value}
            onChangeText={onChangeTrimmed}
            onFocus={onFocus}
            onBlur={onBlur}
            autoCorrect={false}
            autoCompleteType="off"
            returnKeyType="done"
            accessibilityLabel={accessibilityLabel}
            maxLength={8}
            fontSize={26}
            textAlign="center"
            borderWidth={0}
          />
        </Box>
      </Box>
    </>
  );
};
