import DeadlineProgressMirror from "./DeadlineProgressMirror.jsx";
import MindBoxTabBase from "./MindBoxTab.jsx";

export default function MindBoxTab(props) {
  return (
    <>
      <DeadlineProgressMirror payload={props.payload} />
      <MindBoxTabBase {...props} />
    </>
  );
}
