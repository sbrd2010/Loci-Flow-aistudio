import DeadlineProgressMirror from "./DeadlineProgressMirror.jsx";
import MindBoxTabBase from "./MindBoxTab.jsx";

export default function MindBoxTabWithProgressMirror(props) {
  return (
    <>
      <DeadlineProgressMirror payload={props.payload} />
      <MindBoxTabBase {...props} />
    </>
  );
}
