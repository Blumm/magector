<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface AuditPluginInterface
{
    public function afterSave($subject, $result);
}
