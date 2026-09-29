<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class RepoLogger
{
    public function afterSave($subject, $result)
    {
        return $result;
    }

    public function afterRun($subject, $result)
    {
        return $result;
    }
}
