# GitHub issue closeout review — 2026-10-26

Status: Assessment prepared; GitHub publication pending.

Reviewed all 770 open issues and 238 comments against `accf98f64a560a5df9b1bdb175f7ca22331672af` on
`codex/pr557-audit-repairs-20261012`. The live issue bodies match the prior complete
intake; follow-up comments are part of acceptance. Original bodies/comments are
preserved. This audit identifies 27 completed fixes, 150 partial/follow-up owners,
477 recorded implementations awaiting qualification and 116 implementation gaps.
The old 35 “fixed” entries were closing references: eight still need acceptance.

## Qualification

Node 26.12.1, Windows x64. Required native/patch verification exited 0 without
warnings/errors: eight patches, 26 target files, 61 hunks, no dependency rebuild.
Two explicit serial cohorts passed 27/27 cases at the reviewed source: zero
failures, timeouts, skips or native crashes; one attempt, 30-second limits, zero
retries/native-status redo. The publication front gate also passed: 40/40 gate
cases, config/environment budgets, generated freshness, command/workflow contracts
and formatting. The command audit first rejected a nonexistent inherited trusted-
config path; it passed after child-only removal of that invalid setting. This qualifies the listed issue owners, not the full
suite, new implementation batches or separate platform/model/release programs.

The [machine-readable assessment](github-issue-closeout-2026-10-26.json) records
every issue, original body/comment digests, source/test mappings, specific remaining
work and exact passing closure witnesses. Related-test mappings are a starting
selection; only qualifiedTests are executed evidence. Author-workspace raw
responses/logs under `.tmp/tasks/github-issue-closeout-20261026/` are historical
local evidence, not files promised in clean checkouts.

## Completed fixes proposed for closure

- [#627](https://github.com/doublemover/PairOfCleats/issues/627): Balanced Rust tooling parsing and declaration-owned native fields retain lifetime/nesting, ordered parameters, returns, modifiers, documentation and source coverage through registered metadata and replay.
- [#982](https://github.com/doublemover/PairOfCleats/issues/982): Spill checkpoints bind ordered input content and comparator identity; changed inputs cannot reuse stale merged runs.
- [#1022](https://github.com/doublemover/PairOfCleats/issues/1022): LanceDB replacement stages, closes and validates before recoverable promotion; connection/count/metadata failures preserve the prior publication.
- [#1025](https://github.com/doublemover/PairOfCleats/issues/1025): Float16 subnormal carry and ties round correctly for both signs instead of becoming zero.
- [#1039](https://github.com/doublemover/PairOfCleats/issues/1039): Missing/corrupt/mismatched dense artifacts fail before SQLite mutation; a validated empty input remains distinct.
- [#1040](https://github.com/doublemover/PairOfCleats/issues/1040): ANN repair backfills unchanged base vectors and verifies repaired row parity.
- [#1041](https://github.com/doublemover/PairOfCleats/issues/1041): ANN DDL and dense changes share rollback; creation and transaction failures retain prior state.
- [#1060](https://github.com/doublemover/PairOfCleats/issues/1060): Unmapped or ambiguous file identities cannot borrow another file's vector through structural hints or numeric fallback.
- [#1064](https://github.com/doublemover/PairOfCleats/issues/1064): Compaction retains and validates MinHash identity/sampling metadata and subsequent receiver writes.
- [#1071](https://github.com/doublemover/PairOfCleats/issues/1071): Shard rotation uses the locked physical append size even when a writer has not flushed its index.
- [#1078](https://github.com/doublemover/PairOfCleats/issues/1078): Filename spelling remains exact through cache read/write/merge/prune, including leading/trailing spaces.
- [#1079](https://github.com/doublemover/PairOfCleats/issues/1079): Independent LanceDB variants continue after a sibling write or isolate-fallback failure.
- [#1091](https://github.com/doublemover/PairOfCleats/issues/1091): Corrupt manifests recover from validated backup or fail without publishing a manifest that drops prior non-embedding pieces.
- [#1092](https://github.com/doublemover/PairOfCleats/issues/1092): LMDB clear and replacement writes share one transaction; injected failures preserve prior queryable data.
- [#1094](https://github.com/doublemover/PairOfCleats/issues/1094): ID-less dense rows receive sequential fallback IDs while explicit zero and mixed IDs retain their meanings.
- [#1095](https://github.com/doublemover/PairOfCleats/issues/1095): Completed or failed SQLite builds remove their owned exit listener; active-build cleanup remains available.
- [#1096](https://github.com/doublemover/PairOfCleats/issues/1096): A malformed shard without a chunks array rejects instead of reporting a successful import.
- [#1098](https://github.com/doublemover/PairOfCleats/issues/1098): Checksum mismatch, invalid digest and hash-read failure produce failed verification and nonzero CLI status.
- [#1104](https://github.com/doublemover/PairOfCleats/issues/1104): Embedding readiness is published only after final piece publication and artifact validation; boundary faults retain pending/failed state.
- [#1108](https://github.com/doublemover/PairOfCleats/issues/1108): Checked checkpoint and SQLite-owned WAL lifetime preserve committed data while readers pin WAL frames.
- [#1111](https://github.com/doublemover/PairOfCleats/issues/1111): Declared LanceDB payload admission rejects an empty directory, regular file and invalid table payload instead of accepting existence alone.
- [#1113](https://github.com/doublemover/PairOfCleats/issues/1113): LanceDB TTL/capacity/clear retirement retains query leases until in-flight work settles.
- [#1114](https://github.com/doublemover/PairOfCleats/issues/1114): A real 1000-row LanceDB case retains the nearest allowed deep candidate for a large valid filter.
- [#1115](https://github.com/doublemover/PairOfCleats/issues/1115): Concurrent LanceDB table opens coalesce and every retained handle closes after its users drain.
- [#1340](https://github.com/doublemover/PairOfCleats/issues/1340): Text-vector rows bind explicit format, encoding, dimensions, exact length and digest; malformed/legacy/precision-mismatched rows miss safely.
- [#1341](https://github.com/doublemover/PairOfCleats/issues/1341): Query vectors are checked against effective post-fallback provider/artifact identity before cache reuse or ANN admission.
- [#1357](https://github.com/doublemover/PairOfCleats/issues/1357): One serialization owner fans identical bounded bytes to raw and compressed outputs, joining backpressure, sink faults and cancellation.

## Remaining owners

The source review specifically retains synchronous triage cancellation (#586),
untruthful fresh unchecked-freeze return status (#811), complete query-vector
qualification (#1006), TUI follow-up acceptance (#619/#633–635/#638), and the
existing platform/tool/workload programs. Linux/macOS execution, physical-link
creation, real-model runs and release publication are outside this Windows audit.

### Partial/follow-up acceptance — 150

#279, #320, #586, #619, #630, #631, #632, #633, #634, #635, #636, #637, #638, #639, #640, #670, #811, #1006, #1119, #1120, #1121, #1122, #1123, #1131.

#1134, #1144, #1145, #1146, #1147, #1148, #1149, #1150, #1153, #1157, #1158, #1164, #1173, #1177, #1180, #1183, #1188, #1189, #1190, #1191, #1194, #1195, #1196, #1197.

#1201, #1202, #1207, #1208, #1209, #1213, #1214, #1215, #1216, #1217, #1221, #1230, #1233, #1237, #1238, #1243, #1247, #1257, #1258, #1259, #1260, #1261, #1262, #1263.

#1264, #1265, #1266, #1267, #1268, #1269, #1270, #1271, #1272, #1273, #1274, #1278, #1279, #1280, #1282, #1284, #1285, #1286, #1287, #1293, #1294, #1295, #1296, #1297.

#1299, #1300, #1302, #1303, #1304, #1305, #1306, #1307, #1308, #1311, #1312, #1313, #1314, #1317, #1320, #1324, #1330, #1348, #1363, #1364, #1367, #1372, #1381, #1387.

#1388, #1391, #1392, #1395, #1504, #1505, #1506, #1507, #1508, #1509, #1510, #1511, #1512, #1513, #1514, #1515, #1516, #1517, #1518, #1519, #1520, #1521, #1522, #1523.

#1574, #1593, #1643, #1663, #1675, #1733.

### Implementation recorded; qualify — 477

#429, #473, #674, #676, #683, #690, #695, #711, #713, #738, #740, #743, #748, #762, #767, #769, #770, #772, #779, #798, #803, #807, #813, #818.

#855, #865, #883, #893, #904, #967, #978, #979, #980, #981, #983, #984, #985, #986, #987, #988, #989, #990, #991, #992, #993, #994, #995, #996.

#997, #998, #999, #1002, #1003, #1004, #1005, #1007, #1008, #1009, #1010, #1011, #1012, #1013, #1014, #1015, #1016, #1017, #1018, #1019, #1020, #1021, #1023, #1024.

#1026, #1027, #1028, #1029, #1030, #1031, #1032, #1033, #1034, #1035, #1036, #1037, #1038, #1042, #1043, #1044, #1045, #1046, #1047, #1048, #1049, #1050, #1051, #1052.

#1053, #1054, #1055, #1056, #1057, #1058, #1059, #1061, #1062, #1063, #1065, #1066, #1067, #1068, #1069, #1070, #1072, #1073, #1074, #1075, #1076, #1077, #1080, #1081.

#1082, #1083, #1084, #1085, #1086, #1087, #1088, #1089, #1090, #1093, #1097, #1099, #1100, #1101, #1102, #1103, #1105, #1106, #1107, #1109, #1110, #1112, #1116, #1117.

#1118, #1132, #1178, #1182, #1185, #1187, #1198, #1199, #1200, #1203, #1204, #1205, #1206, #1210, #1211, #1212, #1218, #1219, #1220, #1222, #1223, #1224, #1225, #1226.

#1227, #1228, #1229, #1231, #1232, #1234, #1235, #1236, #1239, #1240, #1241, #1242, #1244, #1245, #1246, #1248, #1249, #1250, #1251, #1252, #1253, #1254, #1255, #1256.

#1275, #1276, #1277, #1281, #1283, #1288, #1289, #1290, #1291, #1292, #1298, #1309, #1310, #1315, #1316, #1318, #1319, #1321, #1322, #1323, #1326, #1327, #1328, #1329.

#1331, #1332, #1333, #1334, #1335, #1336, #1337, #1338, #1339, #1342, #1343, #1344, #1345, #1346, #1347, #1349, #1350, #1351, #1352, #1353, #1354, #1355, #1356, #1358.

#1359, #1360, #1361, #1362, #1365, #1366, #1368, #1369, #1370, #1371, #1373, #1374, #1375, #1376, #1377, #1378, #1379, #1380, #1382, #1383, #1384, #1385, #1386, #1389.

#1390, #1393, #1394, #1396, #1397, #1398, #1399, #1407, #1413, #1418, #1423, #1424, #1437, #1440, #1441, #1445, #1453, #1456, #1457, #1458, #1459, #1460, #1461, #1462.

#1463, #1464, #1465, #1466, #1467, #1468, #1469, #1470, #1471, #1472, #1473, #1474, #1475, #1476, #1477, #1478, #1479, #1480, #1481, #1482, #1483, #1484, #1485, #1486.

#1487, #1488, #1489, #1490, #1491, #1492, #1493, #1494, #1495, #1496, #1497, #1498, #1499, #1500, #1501, #1502, #1503, #1541, #1542, #1543, #1544, #1545, #1546, #1547.

#1548, #1549, #1550, #1551, #1552, #1553, #1554, #1561, #1562, #1563, #1564, #1565, #1566, #1567, #1568, #1569, #1570, #1571, #1572, #1573, #1575, #1576, #1577, #1578.

#1579, #1580, #1582, #1583, #1585, #1586, #1587, #1588, #1589, #1591, #1592, #1595, #1597, #1598, #1599, #1600, #1601, #1602, #1605, #1606, #1608, #1609, #1610, #1611.

#1612, #1613, #1614, #1615, #1616, #1617, #1619, #1620, #1622, #1623, #1632, #1633, #1635, #1636, #1637, #1638, #1639, #1640, #1641, #1644, #1645, #1646, #1647, #1648.

#1649, #1651, #1655, #1657, #1658, #1659, #1660, #1661, #1662, #1665, #1666, #1667, #1668, #1669, #1670, #1671, #1673, #1674, #1676, #1677, #1680, #1681, #1682, #1683.

#1684, #1687, #1688, #1689, #1691, #1692, #1694, #1695, #1696, #1698, #1700, #1701, #1702, #1711, #1713, #1714, #1716, #1718, #1719, #1720, #1721, #1724, #1725, #1726.

#1727, #1728, #1729, #1730, #1731, #1732, #1734, #1735, #1736, #1737, #1738, #1739, #1740, #1741, #1742, #1743, #1744, #1745, #1746, #1747, #1748.

### Implementation not established — 116

#131, #147, #173, #216, #229, #248, #275, #277, #284, #289, #292, #347, #356, #371, #385, #668, #672, #681, #726, #821, #1124, #1125, #1126, #1127.

#1128, #1129, #1130, #1133, #1135, #1136, #1137, #1138, #1139, #1140, #1141, #1142, #1143, #1151, #1152, #1154, #1155, #1156, #1159, #1160, #1161, #1162, #1163, #1165.

#1166, #1167, #1168, #1169, #1170, #1171, #1172, #1174, #1175, #1176, #1179, #1181, #1184, #1186, #1192, #1193, #1301, #1325, #1524, #1525, #1526, #1527, #1528, #1529.

#1530, #1531, #1532, #1533, #1534, #1535, #1536, #1537, #1538, #1539, #1540, #1555, #1556, #1557, #1558, #1559, #1560, #1581, #1584, #1590, #1594, #1596, #1603, #1604.

#1607, #1618, #1624, #1625, #1627, #1634, #1642, #1650, #1652, #1653, #1654, #1656, #1664, #1697, #1699, #1707, #1708, #1710, #1722, #1723.

## Publication policy

Each issue receives a maintained review section with source/evidence links and
its remaining closure steps. Eligible issues close as completed on PR572; this
is not a claim they have merged to main. Original titles, descriptions, labels,
assignees, milestones and comments remain intact. Updates are serial and paced;
changed issue bodies/acceptance are re-reviewed before mutation. The final receipt
records verified publication, exceptions and the resulting live census.
