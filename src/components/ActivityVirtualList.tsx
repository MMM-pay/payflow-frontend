"use client";

import { VirtualList } from "@/components/VirtualList";
import type { ActivityItem } from "@/components/Activity";
import type { ReactNode } from "react";

export interface ActivityVirtualListProps {
  items: ActivityItem[];
  keyExtractor: (item: ActivityItem) => string;
  renderItem: (item: ActivityItem) => ReactNode;
}

export default function ActivityVirtualList({
  items,
  keyExtractor,
  renderItem,
}: ActivityVirtualListProps) {
  return (
    <VirtualList
      items={items}
      threshold={100}
      itemHeight={100}
      containerMaxHeight={528}
      overscan={4}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      className="block"
      listAriaLabel="Wallet activity"
    />
  );
}
