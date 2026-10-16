import { cloneElement, isValidElement, type ReactNode } from 'react';
import styles from '../app/research/tape.module.css';
import { linkify } from '../lib/tapeLinks';

const cls = { term: styles.term, addr: styles.addr };

function walk(node: ReactNode): ReactNode {
  if (node == null || typeof node === 'boolean') return node;
  if (typeof node === 'string' || typeof node === 'number') {
    return <span dangerouslySetInnerHTML={{ __html: linkify(String(node), cls) }} />;
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => {
      const walked = walk(child);
      return isValidElement(walked) ? cloneElement(walked, { key: walked.key ?? i }) : walked;
    });
  }
  if (!isValidElement(node)) return node;
  if (node.type === 'a' || node.type === 'script') return node;
  const props = node.props as { children?: ReactNode };
  if (props.children == null) return node;
  return cloneElement(node, undefined, walk(props.children));
}

export function Linked({ children }: { children: ReactNode }) {
  return <>{walk(children)}</>;
}
