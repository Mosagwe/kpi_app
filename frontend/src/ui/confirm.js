import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import "./sweetalert-theme.css";

export async function confirmAction({ title, text, confirmText = "Confirm", danger = false }) {
  const result = await Swal.fire({
    title,
    text,
    icon: danger ? "warning" : "question",
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancel",
    reverseButtons: true,
    focusCancel: true,
    customClass: {
      popup: "app-swal",
      title: "app-swal-title",
      htmlContainer: "app-swal-copy",
      actions: "app-swal-actions",
      confirmButton: danger ? "app-swal-confirm danger" : "app-swal-confirm",
      cancelButton: "app-swal-cancel",
      icon: "app-swal-icon"
    },
    buttonsStyling: false
  });
  return result.isConfirmed;
}
