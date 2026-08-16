import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../contexts/AppContext";
import { downloadFile, toCSV } from "../lib/utils";

interface Props {
	filename: string;
	rows?: object[];
	getRows?: () => Promise<object[]>;
	label?: string;
	disabled?: boolean;
}

export default function ExportCSVButton({
	filename,
	rows,
	getRows,
	label = "Export CSV",
	disabled,
}: Props) {
	const { toast } = useApp();
	const [busy, setBusy] = useState(false);

	const doExport = async () => {
		try {
			setBusy(true);
			const data = getRows ? await getRows() : (rows ?? []);
			if (!data.length) {
				toast("Nothing to export", "err");
				return;
			}
			downloadFile(filename, toCSV(data), "text/csv");
			toast(`Exported ${data.length} rows`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Export failed", "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			className="btn btn-soft !py-2 !px-3 text-sm"
			onClick={doExport}
			disabled={disabled || busy}
		>
			{busy ? (
				<Loader2 size={14} className="animate-spin" />
			) : (
				<Download size={14} />
			)}
			<span>{busy ? "Exporting…" : label}</span>
		</button>
	);
}
