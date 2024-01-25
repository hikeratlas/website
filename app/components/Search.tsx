import React from 'react';

import { useCombobox } from 'downshift';

function cx(...xs: unknown[]): string {
  return xs.filter(x => x).join(' ');
}

export interface Item {
  country: string | null;
  kind: string;
  lat: number;
  lon: number;
  min_lat?: number | null;
  min_lon?: number | null;
  max_lat?: number | null;
  max_lon?: number | null;
  name: string;
  osm_id: string;
  park: string | null;
  qrank: number;
  state: string | null;
  wikidata: string | null;
}

interface Props {
  onSelect?: (item: Item) => void;
}

export default function Search(props: Props) {
  function ComboBox() {
    const [items, setItems] = React.useState([])
    const {
      isOpen,
      getToggleButtonProps,
      getLabelProps,
      getMenuProps,
      getInputProps,
      highlightedIndex,
      getItemProps,
      selectedItem,
    } = useCombobox({
      async onInputValueChange({inputValue}) {
        const response = await fetch(
          `https://lono5me4vqwi2h6dmm66oldkie0hwewm.lambda-url.us-east-1.on.aws/?q=${encodeURIComponent(inputValue)}`
        );

        const json = await response.json();
        setItems(json)
      },
      onSelectedItemChange: (x) => (props.onSelect || (() => {}))(x.selectedItem),
      items,
      itemToString(item) {
        return item ? item.name : ''
      },
    })

    return (
      <div className='autosuggest relative'>
        <div className="w-full flex flex-col gap-1">
          <div className="flex shadow-sm bg-white gap-0.5">
            <input
              placeholder="Search..."
              className="w-full p-1.5 border"
              {...getInputProps()}
            />
          </div>
        </div>
        <ul
          className={`absolute w-full bg-white mt-1 shadow-md max-h-80 p-0 overflow-scroll z-10 ${
            !(isOpen && items.length) && 'hidden'
          }`}
          {...getMenuProps()}
        >
          {isOpen &&
            items.map((item, index) => (
              <li
                className={cx(
                  highlightedIndex === index && 'bg-blue-300',
                  selectedItem === item && 'font-bold',
                  'py-2 px-3 shadow-sm flex flex-col',
                )}
                key={item.osm_id}
                {...getItemProps({item, index})}
              >
                <span>{item.name}</span>
                <span className="text-sm text-gray-700">{[item.park, item.state].filter(x => x).join(', ')}</span>
              </li>
            ))}
        </ul>
      </div>
    )
  }
  return <ComboBox />
}
